package ing.jere.switchboard

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.util.LruCache
import android.webkit.WebResourceResponse
import androidx.core.graphics.drawable.toBitmap
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/**
 * Serves /icon/<pkg>/<activity> as an unmasked square PNG: adaptive icons are drawn with their background
 * and foreground filling the square (the visible 72 of 108 dp), so the page can apply its own icon shape.
 */
class IconHandler(private val ctx: Context) : WebViewAssetLoader.PathHandler {

    private val cache = object : LruCache<String, ByteArray>(CACHE_BYTES) {
        override fun sizeOf(key: String, value: ByteArray): Int = value.size
    }

    override fun handle(path: String): WebResourceResponse? {
        val key = Uri.decode(path).trimStart('/')
        val png = cache.get(key) ?: render(key)?.also { cache.put(key, it) } ?: return null
        return WebResourceResponse("image/png", null, ByteArrayInputStream(png))
    }

    private fun render(key: String): ByteArray? = try {
        val parts = key.split("/", limit = 2)
        val pm = ctx.packageManager
        val icon = if (parts.size == 2) pm.getActivityIcon(ComponentName(parts[0], parts[1])) else pm.getApplicationIcon(parts[0])
        val bitmap = square(icon)
        ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
    } catch (e: Exception) {
        null
    }

    private fun square(icon: Drawable): Bitmap {
        if (icon !is AdaptiveIconDrawable) return icon.toBitmap(SIZE_PX, SIZE_PX, Bitmap.Config.ARGB_8888)
        val bmp = Bitmap.createBitmap(SIZE_PX, SIZE_PX, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        // Layers are 108 dp with the visible area the middle 72 dp: draw them at 1.5x, centred.
        val pad = SIZE_PX / 4
        for (layer in listOfNotNull(icon.background, icon.foreground)) {
            layer.setBounds(-pad, -pad, SIZE_PX + pad, SIZE_PX + pad)
            layer.draw(canvas)
        }
        return bmp
    }

    private companion object {
        const val SIZE_PX = 144
        const val CACHE_BYTES = 16 * 1024 * 1024
    }
}
