package com.ybbarng.skytalk.stayalive

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 연결 지키기를 켜고 끈다.
 *
 * **실패해도 조용히 `false` 를 돌려준다.** 못 켜는 것은 아쉬울 뿐이고,
 * 여기서 터지면 글도 못 쓴다. 안드로이드 12 부터는 앱이 뒤에 있을 때
 * 전경 서비스를 못 켜는데, 그때도 그냥 `false` 다.
 */
class StayAliveModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "reactContext 가 없다" }

  override fun definition() = ModuleDefinition {
    Name("StayAlive")

    Function("isSupported") { true }

    Function("start") {
      try {
        val intent = Intent(context, StayAliveService::class.java)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (cause: Throwable) {
        // 못 켰다. 앱을 보는 동안에는 그대로 된다.
        false
      }
    }

    Function("stop") {
      try {
        context.stopService(Intent(context, StayAliveService::class.java))
        true
      } catch (cause: Throwable) {
        false
      }
    }
  }
}
