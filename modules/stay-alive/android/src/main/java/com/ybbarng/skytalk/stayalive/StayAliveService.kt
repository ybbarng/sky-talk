package com.ybbarng.skytalk.stayalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * 뒤로 가도 연결을 지킨다.
 *
 * ## 왜 전경 서비스만으로는 안 되나
 *
 * 앱이 뒤로 가면 안드로이드는 화면(Activity)을 멈춘다. 그러면
 * React Native 가 `onHostPause` 를 받고 **JS 타이머를 통째로 끈다.**
 * (`JavaTimerManager.kt` 의 `clearFrameCallback`)
 *
 * 타이머가 멎으면 5초마다 보내던 심장박동이 멈춘다. 상대는 15초 뒤
 * "끊겼다" 고 보고 소켓을 닫는다. 붙었다 끊겼다를 되풀이하게 된다.
 *
 * 전경 서비스는 **프로세스가 안 죽게** 할 뿐이고, 타이머는 그대로 멎는다.
 *
 * ## 그래서 HeadlessJsTask 를 쓴다
 *
 * RN 은 헤드리스 작업이 도는 동안에는 타이머를 되살린다.
 *
 * ```kotlin
 * override fun onHeadlessJsTaskStart(taskId: Int) {
 *   if (!isRunningTasks.getAndSet(true)) {
 *     setChoreographerCallback()   // ← 타이머가 다시 돈다
 *   }
 * }
 * ```
 *
 * 그래서 이 서비스는 둘을 겹친다.
 *
 *   전경 서비스        — 프로세스를 안 죽게
 *   HeadlessJsTask    — 타이머를 살려둠
 *
 * ## 언제 멈추나
 *
 * JS 쪽 작업이 끝나면 RN 이 `onHeadlessJsTaskFinish` 를 부르고,
 * 거기서 `stopSelf()` 가 불린다. 그래서 **멈추는 것도 JS 가 정한다.**
 * (docs/04-transport-spec.md 2.7)
 */
class StayAliveService : HeadlessJsTaskService() {

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // **5초 안에 알림을 띄워야 한다.** 안 그러면 안드로이드가 서비스를
    // 죽인다. 그래서 JS 를 띄우기 전에 먼저 한다.
    startForegroundNotice()
    return super.onStartCommand(intent, flags, startId)
  }

  /**
   * 무엇을 돌릴지.
   *
   * `timeout = 0` 이면 시간 제한이 없다. 세 시간을 버텨야 한다.
   * `allowedInForeground = true` 여야 앱을 보는 동안에도 켤 수 있다.
   * 켜는 시점은 대화 화면이 열릴 때, 즉 앱이 앞에 있을 때다.
   */
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(TASK_NAME, Arguments.createMap(), 0, true)

  private fun startForegroundNotice() {
    val manager = getSystemService(NotificationManager::class.java)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      /**
       * 가장 낮은 중요도로 둔다.
       *
       * 이 알림은 안드로이드가 강제하는 것이지 사람에게 알릴 말이
       * 아니다. **소리도 진동도 내지 않는다.** 세 시간 내내 떠 있을
       * 것이라 조용해야 한다.
       */
      val channel = NotificationChannel(
        CHANNEL_ID,
        "연결 지키기",
        NotificationManager.IMPORTANCE_MIN,
      )
      channel.setShowBadge(false)
      channel.enableVibration(false)
      channel.setSound(null, null)
      manager?.createNotificationChannel(channel)
    }

    val notice = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("대화를 이어두고 있어요")
      .setContentText("폰을 내려놔도 상대 말이 들어와요")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      // 누르면 앱으로 돌아간다. 알림에서 빠져나갈 길이 있어야 한다.
      .setContentIntent(openAppIntent())
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTICE_ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(NOTICE_ID, notice)
    }
  }

  private fun openAppIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null

    return PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  companion object {
    /** JS 쪽에서 `AppRegistry.registerHeadlessTask` 로 같은 이름을 등록한다 */
    const val TASK_NAME = "SkyTalkStayAlive"

    private const val CHANNEL_ID = "stay-alive"
    private const val NOTICE_ID = 4823
  }
}
