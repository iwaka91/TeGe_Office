plugins {
    id("com.android.application")
}

android {
    namespace = "com.totogutomo.tgpdflab"
    compileSdk = 36
    compileSdkExtension = 19

    defaultConfig {
        applicationId = "com.totogutomo.tgpdflab"
        minSdk = 28
        targetSdk = 35
        versionCode = 8
        versionName = "0.6.0-lab"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        viewBinding = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.13.0")
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.pdf:pdf-viewer-fragment:1.0.0-beta01")
}
