package ing.jere.switchboard

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.LauncherApps
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.UserHandle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Switchboard's home screen: one WebView running switchboard/index.html (bundled into the APK), with
 * window.SBNative for the phone. Native events reach the page as window.SB.onNative(type, json).
 * The WebView sits inside the system bars; the strips behind the bars take the page's own colour.
 */
class MainActivity : ComponentActivity() {

    lateinit var web: WebView
        private set
    private lateinit var root: FrameLayout
    private lateinit var native: Native

    private var pageReady = false
    private var resumed = false
    private var lastMedia = ""
    private var lastBattery = ""
    private var tick = 0
    private val main = Handler(Looper.getMainLooper())

    private val launcherApps: LauncherApps by lazy { requireNotNull(getSystemService(LauncherApps::class.java)) }

    private val permLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { emit("perms") }
    private val roleLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { emit("perms") }

    private val appsCallback = object : LauncherApps.Callback() {
        override fun onPackageRemoved(packageName: String?, user: UserHandle?) = appsChanged()
        override fun onPackageAdded(packageName: String?, user: UserHandle?) = appsChanged()
        override fun onPackageChanged(packageName: String?, user: UserHandle?) = appsChanged()
        override fun onPackagesAvailable(packageNames: Array<out String>?, user: UserHandle?, replacing: Boolean) = appsChanged()
        override fun onPackagesUnavailable(packageNames: Array<out String>?, user: UserHandle?, replacing: Boolean) = appsChanged()
    }

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val b = native.battery()
            if (b != lastBattery) {
                lastBattery = b
                emit("battery", jsString(b))
            }
        }
    }

    /** While Switchboard is in front: push media changes, and match the bar strips to the page every 3 s. */
    private val pulse = object : Runnable {
        override fun run() {
            if (!resumed) return
            val m = native.media()
            if (m != lastMedia) {
                lastMedia = m
                emit("media", jsString(m))
            }
            if (tick++ % 2 == 0) matchBars()
            main.postDelayed(this, PULSE_MS)
        }
    }

    private val notifsChanged: () -> Unit = { emit("notifs") }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        current = WeakReference(this)
        native = Native(this)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/icon/", IconHandler(this))
            .build()

        val bg = getColor(R.color.bg)
        web = WebView(this).apply {
            setBackgroundColor(bg)
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            isHapticFeedbackEnabled = true
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                textZoom = 100
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                mediaPlaybackRequiresUserGesture = true
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == HOST) return false
                    openExternal(request.url)
                    return true
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    pageReady = true
                    matchBars()
                }
            }
            addJavascriptInterface(native, JS_NAME)
        }

        root = FrameLayout(this).apply {
            setBackgroundColor(bg)
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = emit("back")
        })
        launcherApps.registerCallback(appsCallback)
        Notifs.onChange = notifsChanged
        Reminders.channel(this)
        web.loadUrl(START)
        handleReminderIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == Intent.ACTION_MAIN && intent.hasCategory(Intent.CATEGORY_HOME)) emit("home")
        handleReminderIntent(intent)
    }

    private fun handleReminderIntent(intent: Intent?) {
        val id = intent?.getStringExtra(Reminders.EXTRA_ID) ?: return
        intent.removeExtra(Reminders.EXTRA_ID)
        emit("remind", jsString(id))
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        web.resumeTimers()
        web.onResume()
        ContextCompat.registerReceiver(
            this, batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        emit("resume")
        main.removeCallbacks(pulse)
        main.post(pulse)
    }

    override fun onPause() {
        resumed = false
        main.removeCallbacks(pulse)
        runCatching { unregisterReceiver(batteryReceiver) }
        web.onPause()
        web.pauseTimers()
        super.onPause()
    }

    override fun onDestroy() {
        if (Notifs.onChange === notifsChanged) Notifs.onChange = null
        if (current?.get() === this) current = null
        launcherApps.unregisterCallback(appsCallback)
        web.removeJavascriptInterface(JS_NAME)
        web.destroy()
        super.onDestroy()
    }

    private fun appsChanged() {
        native.invalidateApps()
        emit("apps")
    }

    /** Calls window.SB.onNative(type, data) on the page. [data] is a JS expression (default `null`). */
    fun emit(type: String, data: String = "null") {
        if (!::web.isInitialized) return
        web.post {
            if (pageReady) web.evaluateJavascript("window.SB&&SB.onNative('$type',$data)", null)
        }
    }

    /**
     * The page picks its own skin (auto / dark / black / light). Read the colour it painted at the top and
     * bottom and give the bar strips the same, with bar icons that read on it.
     */
    private fun matchBars() {
        if (!pageReady) return
        val js = "(function(){function c(s){var e=document.querySelector(s);return e?getComputedStyle(e).backgroundColor:''}" +
            "return [c('.space-head')||c('.chanlist')||getComputedStyle(document.body).backgroundColor, c('.tabs')||getComputedStyle(document.body).backgroundColor]})()"
        web.evaluateJavascript(js) { result ->
            val parts = Regex("rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)").findAll(result ?: "").toList()
            if (parts.isEmpty()) return@evaluateJavascript
            val (r, g, b) = parts[0].destructured
            val top = Color.rgb(r.toInt(), g.toInt(), b.toInt())
            root.setBackgroundColor(top)
            val light = (0.299 * r.toInt() + 0.587 * g.toInt() + 0.114 * b.toInt()) > 150
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = light
                isAppearanceLightNavigationBars = light
            }
        }
    }

    // ---------------------------------------------------------------- used by Native

    /** Opens "package/activity". Returns false if it couldn't. */
    fun launch(key: String): Boolean {
        val parts = key.split("/", limit = 2)
        if (parts.size < 2) return false
        val intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setComponent(ComponentName(parts[0], parts[1]))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        return try {
            startActivity(intent)
            true
        } catch (e: Exception) {
            launchPackage(parts[0])
        }
    }

    fun launchPackage(pkg: String): Boolean {
        val i = packageManager.getLaunchIntentForPackage(pkg) ?: return false
        return start(i)
    }

    fun openExternal(uri: Uri): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    /** Starts [intent] in a new task. Returns false if nothing handles it. */
    fun start(intent: Intent): Boolean = try {
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (e: Exception) {
        false
    }

    /** Runtime permission dialog; the page gets a "perms" event when it closes. */
    fun askPermissions(perms: Array<String>) {
        runOnUiThread { permLauncher.launch(perms) }
    }

    /** Asks to become the default home app (role dialog on Android 10+, else the home settings screen). */
    fun requestHome() {
        runOnUiThread {
            if (Build.VERSION.SDK_INT >= 29) {
                val rm = getSystemService(RoleManager::class.java)
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME) && !rm.isRoleHeld(RoleManager.ROLE_HOME)) {
                    try {
                        roleLauncher.launch(rm.createRequestRoleIntent(RoleManager.ROLE_HOME))
                        return@runOnUiThread
                    } catch (e: Exception) {
                        // Fall through to the settings screen.
                    }
                }
            }
            start(Intent(Settings.ACTION_HOME_SETTINGS))
        }
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val START = "https://$HOST/assets/www/index.html"

        /** What the page looks for: window.SBNative. */
        const val JS_NAME = "SBNative"
        private const val PULSE_MS = 1500L

        /** The live activity, for receivers that need to tell the page something. */
        @Volatile
        var current: WeakReference<MainActivity>? = null

        fun jsString(s: String): String = JSONObject.quote(s)
    }
}
