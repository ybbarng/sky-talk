package com.ybbarng.skywalkie.bleperipheral

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * 안드로이드가 블루투스로 자기를 알린다.
 *
 * **아이폰 쪽과 똑같은 이름(`BlePeripheral`)을 쓴다.** 그래야 JS 가
 * 어느 폰인지 신경 쓰지 않고 같은 코드를 부른다.
 *
 * ## 왜 안드로이드가 알리는 쪽이어야 하나
 *
 * iOS 는 앱이 뒤로 가면 알림에 담긴 서비스 번호를 **애플 기기만 읽는
 * 자리로 옮긴다.** 그래서 아이폰이 알리는 쪽이면 아이폰 앱이 앞에 떠
 * 있을 때만 상대가 찾을 수 있다. 여자친구가 영화를 보는 동안 연결이
 * 끊기면 **앱을 다시 열기 전까지 복구가 안 된다.**
 *
 * 반대로 안드로이드는 앞쪽 알림을 띄운 채 계속 알릴 수 있고, iOS 는
 * 뒤에 있어도 정해둔 서비스 번호로 찾을 수 있다. 그래서 이쪽이 맞다.
 *
 * ## 안드로이드끼리도 이어진다
 *
 * 이 모듈이 생기면서 **안드로이드 두 대로도 시험할 수 있다.** 전에는
 * 아이폰만 알릴 수 있어서 둘 다 찾기만 하다 영영 못 만났다.
 *
 * ## 없으면 없는 대로 둔다
 *
 * 알리는 장치가 없는 기기가 있다. 그때는 "못 한다" 고만 답하고
 * **여기서 앱이 죽으면 안 된다.** 덤 하나 때문에 대화를 통째로 못
 * 하게 되는 것이 이 앱에서 가장 나쁜 일이다.
 *
 * (docs/04-transport-spec.md 4장 · T20)
 */

private val SERVICE_UUID: UUID = UUID.fromString("F7D5061F-298D-46DB-BE86-D1E0C757AB23")
private val INBOX_UUID: UUID = UUID.fromString("0F52C6B6-FDDA-4E0C-886A-0BB1CA261494")
private val OUTBOX_UUID: UUID = UUID.fromString("8966097A-CE16-4B4B-99C4-5DD2409FC9F7")
private val STATUS_UUID: UUID = UUID.fromString("F9F2387C-9014-4C34-AB13-EC01330DB314")
private val CONTROL_UUID: UUID = UUID.fromString("57998665-F536-4E22-BBE8-0302580269C6")

/**
 * 듣겠다고 표시하는 자리.
 *
 * 블루투스가 정해둔 번호다. 우리가 고른 것이 아니다. 찾는 쪽이 여기에
 * 쓰면 "알림을 받겠다" 는 뜻이 된다.
 */
private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

/** 협상 전 기본값. 3바이트는 블루투스가 가져간다 */
private const val DEFAULT_MTU = 23

/** 이만큼 밀리면 더 안 받는다. 사진 하나가 400조각쯤이라 넉넉히 둔다 */
private const val MAX_BACKLOG = 4_000
private const val ATT_OVERHEAD = 3

class BlePeripheralModule : Module() {
  private var adapter: BluetoothAdapter? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var server: BluetoothGattServer? = null
  private var outbox: BluetoothGattCharacteristic? = null

  /** 듣고 있는 상대들 */
  private val listeners = mutableListOf<BluetoothDevice>()

  /** 보낼 자리가 없어 밀려난 것들. 자리가 나면 여기부터 보낸다 */
  private val backlog = ArrayDeque<ByteArray>()

  private var mtu = DEFAULT_MTU
  private var advertising = false

  /**
   * 알리기를 시작해달라고 한 뒤 답을 기다리는 쪽.
   *
   * **`startAdvertising` 을 부른다고 알려지는 게 아니다.** 되는지 안
   * 되는지는 여기 콜백으로 나중에 온다. 이걸 안 기다리면 실패했는데도
   * 열린 것으로 치고, 아무도 우리를 못 보는 채로 기다리게 된다.
   */
  private var pending: Promise? = null

  private fun settle(started: Boolean) {
    val waiting = pending ?: return
    pending = null
    waiting.resolve(started)
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
      advertising = true
      emitState("on")
      settle(true)
    }

    override fun onStartFailure(errorCode: Int) {
      advertising = false
      // **여기서 예외를 던지지 않는다.** 알리기가 안 되는 것뿐이고
      // 다른 길은 아직 살아 있다.
      emitState("failed")
      settle(false)
    }
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        listeners.removeAll { it.address == device.address }
        if (listeners.isEmpty()) {
          backlog.clear()
          mtu = DEFAULT_MTU
        }
        emitSubscribe(false, 0)
      }
    }

    override fun onMtuChanged(device: BluetoothDevice, size: Int) {
      mtu = size
      // 이미 듣고 있는 상대라면 새 크기를 알려준다. 넘겨 보내면
      // 조용히 잘린다.
      if (listeners.any { it.address == device.address }) {
        emitSubscribe(true, usableBytes())
      }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      if (characteristic.uuid == INBOX_UUID && value != null) {
        emit("onReceive", mapOf("data" to Base64.encodeToString(value, Base64.NO_WRAP)))
      }

      // 답을 요구하는 쓰기에는 답해야 한다. 안 그러면 상대가 멈춘다.
      if (responseNeeded) {
        server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
      }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      if (descriptor.uuid == CCCD_UUID && descriptor.characteristic.uuid == OUTBOX_UUID) {
        val wantsIt = value != null &&
          value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)

        if (wantsIt) {
          if (listeners.none { it.address == device.address }) listeners.add(device)
          emitSubscribe(true, usableBytes())
        } else {
          listeners.removeAll { it.address == device.address }
          if (listeners.isEmpty()) backlog.clear()
          emitSubscribe(false, 0)
        }
      }

      if (responseNeeded) {
        server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
      }
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
      // 자리가 났다. 밀린 것을 마저 보낸다.
      if (status == BluetoothGatt.GATT_SUCCESS) flush()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("BlePeripheral")

    Events("onReceive", "onStateChange", "onSubscribe")

    /** 이 기기에서 알릴 수 있나. **없을 수 있다는 전제로 쓴다.** */
    Function("isSupported") {
      runCatching { bluetoothAdapter()?.isMultipleAdvertisementSupported == true }
        .getOrDefault(false)
    }

    AsyncFunction("start") { localName: String, promise: Promise ->
      if (advertising) {
        promise.resolve(true)
        return@AsyncFunction
      }

      pending = promise

      val asked = runCatching { startAdvertising(localName) }.getOrElse {
        emitState("failed")
        false
      }

      // 시작조차 못 했으면 콜백이 안 온다. 여기서 끝낸다.
      if (!asked) settle(false)
    }

    AsyncFunction("stop") {
      runCatching { stopAdvertising() }.getOrDefault(false)
    }

    /**
     * 조각 하나를 보낸다.
     *
     * 보낼 자리가 없으면 `false` 를 돌려준다. **거기서 멈추고 기다려야
     * 한다.** 계속 밀어 넣으면 조용히 버려진다.
     */
    AsyncFunction("send") { base64: String ->
      runCatching { sendChunk(base64) }.getOrDefault(false)
    }

    Function("isAdvertising") { advertising }
  }

  private fun bluetoothAdapter(): BluetoothAdapter? {
    if (adapter != null) return adapter

    val context = appContext.reactContext ?: return null
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    adapter = manager?.adapter
    return adapter
  }

  private fun startAdvertising(localName: String): Boolean {
    if (advertising) return true

    val context = appContext.reactContext ?: return false
    val bluetooth = bluetoothAdapter() ?: run {
      emitState("unsupported")
      return false
    }

    if (!bluetooth.isEnabled) {
      emitState("off")
      return false
    }

    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      ?: return false

    // **권한이 없으면 여기서 예외가 난다.** 잡아서 "못 한다" 로
    // 돌려준다. 앱이 죽으면 다른 길까지 막힌다.
    val opened = manager.openGattServer(context, serverCallback) ?: run {
      emitState("denied")
      return false
    }
    server = opened

    opened.addService(buildService())

    val ble = bluetooth.bluetoothLeAdvertiser ?: run {
      emitState("unsupported")
      return false
    }
    advertiser = ble

    // **이름을 알림에 담지 않는다.** 알림 한 칸이 31바이트뿐인데
    // 서비스 번호(16바이트)만으로도 꽉 찬다. 이름까지 넣으면 알리기가
    // 통째로 실패한다. 이름은 이어진 뒤 인사 봉투로 주고받는다.
    //
    // **폰의 블루투스 이름도 건드리지 않는다.** 남의 이름을 바꾸는
    // 일이고, 권한에 따라 터지기도 한다.

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .setTimeout(0)
      .build()

    val data = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .build()

    ble.startAdvertising(settings, data, advertiseCallback)
    return true
  }

  private fun buildService(): BluetoothGattService {
    val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

    val inbox = BluetoothGattCharacteristic(
      INBOX_UUID,
      BluetoothGattCharacteristic.PROPERTY_WRITE or
        BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
      BluetoothGattCharacteristic.PERMISSION_WRITE,
    )

    val out = BluetoothGattCharacteristic(
      OUTBOX_UUID,
      BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_READ,
    )
    out.addDescriptor(
      BluetoothGattDescriptor(
        CCCD_UUID,
        BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
      ),
    )
    outbox = out

    val status = BluetoothGattCharacteristic(
      STATUS_UUID,
      BluetoothGattCharacteristic.PROPERTY_READ or
        BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_READ,
    )
    status.addDescriptor(
      BluetoothGattDescriptor(
        CCCD_UUID,
        BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
      ),
    )

    val control = BluetoothGattCharacteristic(
      CONTROL_UUID,
      BluetoothGattCharacteristic.PROPERTY_WRITE,
      BluetoothGattCharacteristic.PERMISSION_WRITE,
    )

    service.addCharacteristic(inbox)
    service.addCharacteristic(out)
    service.addCharacteristic(status)
    service.addCharacteristic(control)
    return service
  }

  private fun stopAdvertising(): Boolean {
    runCatching { advertiser?.stopAdvertising(advertiseCallback) }
    runCatching { server?.close() }

    advertiser = null
    server = null
    outbox = null
    listeners.clear()
    backlog.clear()
    mtu = DEFAULT_MTU
    advertising = false
    return true
  }

  /**
   * 조각 하나를 줄에 세운다.
   *
   * **줄에 세웠으면 `true` 다.** 자리가 없어 당장 못 나가도 `onNotificationSent`
   * 가 오면 마저 나간다. 예전에는 자리가 없으면 `false` 를 돌려줬는데, 그러면
   * JS 가 실패로 보고 멈추는데 실제로는 뒤늦게 나가서 같은 조각이 두 번 갔다.
   *
   * 듣는 상대가 없거나 줄이 너무 길면 `false`. 그때는 정말 못 보낸 것이다.
   */
  private fun sendChunk(base64: String): Boolean {
    if (outbox == null) return false
    if (listeners.isEmpty()) return false
    if (backlog.size >= MAX_BACKLOG) return false

    val data = runCatching { Base64.decode(base64, Base64.NO_WRAP) }.getOrNull() ?: return false

    // 밀린 것이 있으면 순서를 지킨다. 새것을 먼저 보내면 말이 뒤엉킨다.
    backlog.addLast(data)
    flush()
    return true
  }

  /** 자리가 났을 때 밀린 것을 내보낸다 */
  private fun flush(): Boolean {
    val out = outbox ?: return false
    if (listeners.isEmpty()) return false

    while (backlog.isNotEmpty()) {
      val next = backlog.first()
      if (!notify(out, next)) return false
      backlog.removeFirst()
    }

    return true
  }

  private fun notify(out: BluetoothGattCharacteristic, data: ByteArray): Boolean {
    val gatt = server ?: return false

    for (device in listeners) {
      val sent = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          gatt.notifyCharacteristicChanged(device, out, false, data) ==
            BluetoothGatt.GATT_SUCCESS
        } else {
          @Suppress("DEPRECATION")
          out.value = data
          @Suppress("DEPRECATION")
          gatt.notifyCharacteristicChanged(device, out, false)
        }
      }.getOrDefault(false)

      if (!sent) {
        // 자리가 없다. 밀어두고 `onNotificationSent` 를 기다린다.
        if (backlog.firstOrNull() !== data) backlog.addFirst(data)
        return false
      }
    }

    return true
  }

  /** 한 번에 실어 보낼 수 있는 바이트 */
  private fun usableBytes(): Int = mtu - ATT_OVERHEAD

  private fun emitState(state: String) {
    emit("onStateChange", mapOf("state" to state))
  }

  private fun emitSubscribe(subscribed: Boolean, size: Int) {
    emit("onSubscribe", mapOf("subscribed" to subscribed, "mtu" to size))
  }

  private fun emit(name: String, body: Map<String, Any>) {
    // 듣는 쪽이 없을 수 있다. 그것 때문에 죽지 않는다.
    runCatching { sendEvent(name, body) }
  }
}
