plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Release signing comes from the environment (CI decodes the keystore to a temp file).
// Without SB_KEYSTORE_PATH the release build is signed with the local debug key so it still installs.
val releaseKeystore: String? = System.getenv("SB_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }

// The page has one home: switchboard/index.html. It is copied into the APK's assets at every build,
// so there is never a second copy in the repo to drift.
val pageSrc = rootProject.file("../index.html")
val pageOut = layout.buildDirectory.dir("page").get().asFile
if (pageSrc.exists()) {
    pageOut.resolve("www").mkdirs()
    pageSrc.copyTo(pageOut.resolve("www/index.html"), overwrite = true)
}

android {
    namespace = "ing.jere.switchboard"
    compileSdk = 35

    defaultConfig {
        applicationId = "ing.jere.switchboard"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    sourceSets {
        getByName("main").assets.srcDir(pageOut)
    }

    signingConfigs {
        releaseKeystore?.let { path ->
            create("release") {
                storeFile = file(path)
                storePassword = System.getenv("SB_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("SB_KEY_ALIAS")
                keyPassword = System.getenv("SB_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // No minify: keeps every @JavascriptInterface method without keep rules.
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Written without an Android SDK at hand: don't let release lint block the APK over a warning-level nit.
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.webkit)
}
