plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "tv.swarmcast"
    compileSdk = 35

    defaultConfig {
        applicationId = "tv.swarmcast"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        manifestPlaceholders["swarmcastApiBase"] =
            providers.gradleProperty("SWARMCAST_API_BASE").orElse("https://swarmcast.local").get()
        manifestPlaceholders["swarmcastTrackerWsUrl"] =
            providers.gradleProperty("SWARMCAST_TRACKER_WS_URL").orElse("wss://swarmcast.local/tracker").get()
        manifestPlaceholders["swarmcastAppApiKey"] =
            providers.gradleProperty("SWARMCAST_APP_API_KEY").orElse("dev-app-key").get()
        manifestPlaceholders["swarmcastP2pEnabled"] =
            providers.gradleProperty("SWARMCAST_P2P_ENABLED").orElse("true").get()
        manifestPlaceholders["swarmcastEdgeOnlyMode"] =
            providers.gradleProperty("SWARMCAST_EDGE_ONLY_MODE").orElse("false").get()
        manifestPlaceholders["swarmcastRlncEnabled"] =
            providers.gradleProperty("SWARMCAST_RLNC_ENABLED").orElse("false").get()
        manifestPlaceholders["swarmcastPlayIntegrityEnabled"] =
            providers.gradleProperty("SWARMCAST_PLAY_INTEGRITY_ENABLED").orElse("false").get()
        manifestPlaceholders["swarmcastPlayIntegrityCloudProjectNumber"] =
            providers.gradleProperty("SWARMCAST_PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER").orElse("0").get()
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    val media3 = "1.6.0"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation(platform("androidx.compose:compose-bom:2025.01.00"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.getstream:stream-webrtc-android:1.3.8")
    implementation("com.github.Backblaze:JavaReedSolomon:d3c481dc69471e0c47ff6f67f33d53bde941675e")
    implementation("com.google.android.play:integrity:1.6.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

dependencyLocking {
    lockAllConfigurations()
}
