plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Release builds are signed with the Google Play upload key from .secrets/
// (gitignored; see the README). Without it, release builds are left unsigned.
val uploadKeystore = rootProject.file("../.secrets/nc-upload.keystore")
val uploadKeystorePassword = providers.environmentVariable("NC_ANDROID_KEYSTORE_PASS").orNull

android {
    namespace = "net.a2f0.nc"
    compileSdk = 37

    defaultConfig {
        // Permanent once published on Google Play.
        applicationId = "net.a2f0.nc"
        minSdk = 26
        targetSdk = 36
        // Release lanes pass the next Play version code with -PncVersionCode=<n>.
        versionCode = providers.gradleProperty("ncVersionCode").orNull?.toInt() ?: 1
        versionName = "1.0"
    }

    signingConfigs {
        if (uploadKeystore.isFile && uploadKeystorePassword != null) {
            create("upload") {
                storeFile = uploadKeystore
                storePassword = uploadKeystorePassword
                keyAlias = "nc-upload"
                keyPassword = uploadKeystorePassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("upload")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    // Lists the languages in res/ (values-*, written by `bun run l10n`) in the system's
    // per-app language setting, on Android 13 and later.
    androidResources {
        generateLocaleConfig = true
    }

    // Google Play installs only the device's languages from an App Bundle unless they're
    // packaged together, and then the app's language setting couldn't switch to the others.
    bundle {
        language {
            enableSplit = false
        }
    }

    // Robolectric tests (e.g. PlaybackServiceTest) build notifications from app resources,
    // and its Android 16 runtime reaches into a JDK internal on newer JDKs.
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all { it.jvmArgs("--add-opens=java.base/jdk.internal.access=ALL-UNNAMED") }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.glance.appwidget)
    implementation(libs.androidx.glance.material3)

    constraints {
        // Glance only asks for WorkManager 2.7.1, whose Room 2.2.5 keep rules let R8 (full
        // mode) remove WorkDatabase_Impl's constructor, so release builds crash at launch.
        implementation(libs.androidx.work.runtime.ktx)
    }

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
}

// Launcher, notification, and splash images are generated from the SVGs in
// assets/ (see scripts/buildAndroidImages.sh) and gitignored. Regenerate them
// whenever the sources change, before anything reads resources.
val repoRoot: Directory = rootProject.layout.projectDirectory.dir("..")
val generateImages = tasks.register<Exec>("generateImages") {
    description = "Generates image resources from assets/*.svg."
    inputs.files(
        repoRoot.file("assets/icon.svg"),
        repoRoot.file("assets/background.svg"),
        repoRoot.file("scripts/buildAndroidImages.sh"),
        repoRoot.file("scripts/lib/images.sh"),
    )
    val res = layout.projectDirectory.dir("src/main/res")
    listOf("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi").forEach { density ->
        outputs.dir(res.dir("mipmap-$density"))
        outputs.dir(res.dir("drawable-$density"))
    }
    outputs.file(res.file("values/generated_colors.xml"))
    commandLine("sh", repoRoot.file("scripts/buildAndroidImages.sh").asFile.path)
}
tasks.named("preBuild") { dependsOn(generateImages) }
