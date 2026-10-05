plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.noiseconnoisseur.app"
    compileSdk = 37

    defaultConfig {
        // Permanent once published on Google Play.
        applicationId = "com.noiseconnoisseur.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
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
