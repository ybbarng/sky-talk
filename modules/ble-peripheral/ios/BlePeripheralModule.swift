import CoreBluetooth
import ExpoModulesCore

/**
 아이폰이 블루투스로 자기를 알린다.

 **자주 쓰는 라이브러리는 찾는 쪽만 한다.** 알리는 쪽은 마땅한 것이
 없어서 직접 만든다. 핫스팟을 못 쓸 때 — 항공사가 개인 핫스팟을
 금지할 때 — 글로라도 대화하려면 이게 필요하다.

 Wi-Fi 와 역할이 반대다. 아이폰이 알리고 안드로이드가 찾는다.
 각 운영체제가 잘하는 쪽에 맞췄다. iOS 는 화면이 꺼져도 제한적으로
 알림을 이어가고, 안드로이드는 찾는 동작에 제약이 적다.

 (docs/04-transport-spec.md 4장 · T20)
 */

private let serviceUUID = CBUUID(string: "F7D5061F-298D-46DB-BE86-D1E0C757AB23")
private let inboxUUID = CBUUID(string: "0F52C6B6-FDDA-4E0C-886A-0BB1CA261494")
private let outboxUUID = CBUUID(string: "8966097A-CE16-4B4B-99C4-5DD2409FC9F7")
private let statusUUID = CBUUID(string: "F9F2387C-9014-4C34-AB13-EC01330DB314")
private let controlUUID = CBUUID(string: "57998665-F536-4E22-BBE8-0302580269C6")

public class BlePeripheralModule: Module {
  private var manager: CBPeripheralManager?
  private var delegate: PeripheralDelegate?

  public func definition() -> ModuleDefinition {
    Name("BlePeripheral")

    Events("onReceive", "onStateChange", "onSubscribe")

    /// 이 기기에서 알릴 수 있나. **없을 수 있다는 전제로 쓴다.**
    Function("isSupported") { () -> Bool in
      return true
    }

    AsyncFunction("start") { (localName: String, promise: Promise) in
      if self.manager != nil {
        promise.resolve(true)
        return
      }

      let handler = PeripheralDelegate(
        localName: localName,
        emit: { [weak self] name, body in
          self?.sendEvent(name, body)
        }
      )

      self.delegate = handler
      self.manager = CBPeripheralManager(delegate: handler, queue: nil)
      handler.manager = self.manager

      promise.resolve(true)
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.delegate?.teardown()
      self.manager = nil
      self.delegate = nil
      promise.resolve(true)
    }

    /// 조각 하나를 상대에게 보낸다.
    ///
    /// 보낼 자리가 없으면 `false` 를 돌려준다. **거기서 멈추고
    /// 기다려야 한다.** 계속 밀어 넣으면 조용히 버려진다.
    AsyncFunction("send") { (base64: String, promise: Promise) in
      guard let handler = self.delegate else {
        promise.resolve(false)
        return
      }
      promise.resolve(handler.send(base64: base64))
    }

    Function("isAdvertising") { () -> Bool in
      return self.manager?.isAdvertising ?? false
    }
  }
}

private class PeripheralDelegate: NSObject, CBPeripheralManagerDelegate {
  weak var manager: CBPeripheralManager?

  private let localName: String
  private let emit: (String, [String: Any]) -> Void

  private var outbox: CBMutableCharacteristic?
  private var subscribers: [CBCentral] = []

  /// 보낼 자리가 없어 밀려난 것들. 자리가 나면 여기부터 보낸다.
  private var backlog: [Data] = []

  /// 이만큼 밀리면 더 안 받는다. 사진 하나가 400조각쯤이라 넉넉히 둔다
  private let maxBacklog = 4_000

  init(localName: String, emit: @escaping (String, [String: Any]) -> Void) {
    self.localName = localName
    self.emit = emit
  }

  func teardown() {
    manager?.stopAdvertising()
    manager?.removeAllServices()
    subscribers.removeAll()
    backlog.removeAll()
  }

  /// 조각 하나를 줄에 세운다.
  ///
  /// **줄에 세웠으면 `true` 다.** 자리가 없어 당장 못 나가도
  /// `peripheralManagerIsReady` 가 오면 마저 나간다. 듣는 상대가 없거나
  /// 줄이 너무 길면 `false`. 그때는 정말 못 보낸 것이다.
  func send(base64: String) -> Bool {
    guard
      let data = Data(base64Encoded: base64),
      outbox != nil,
      !subscribers.isEmpty,
      backlog.count < maxBacklog
    else {
      return false
    }

    // 밀린 것이 있으면 순서를 지킨다. 새것을 먼저 보내면 말이 뒤엉킨다.
    backlog.append(data)
    flush()
    return true
  }

  /// 자리가 났을 때 밀린 것을 내보낸다
  @discardableResult
  private func flush() -> Bool {
    guard let outbox = outbox, !subscribers.isEmpty else { return false }

    while let next = backlog.first {
      let sent = manager?.updateValue(
        next,
        for: outbox,
        onSubscribedCentrals: subscribers
      ) ?? false

      if !sent { return false }
      backlog.removeFirst()
    }

    return true
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    emit("onStateChange", ["state": describe(peripheral.state)])

    guard peripheral.state == .poweredOn else { return }
    publish(on: peripheral)
  }

  private func publish(on peripheral: CBPeripheralManager) {
    let inbox = CBMutableCharacteristic(
      type: inboxUUID,
      properties: [.writeWithoutResponse, .write],
      value: nil,
      permissions: [.writeable]
    )

    let out = CBMutableCharacteristic(
      type: outboxUUID,
      properties: [.notify],
      value: nil,
      permissions: [.readable]
    )

    let status = CBMutableCharacteristic(
      type: statusUUID,
      properties: [.read, .notify],
      value: nil,
      permissions: [.readable]
    )

    let control = CBMutableCharacteristic(
      type: controlUUID,
      properties: [.write],
      value: nil,
      permissions: [.writeable]
    )

    let service = CBMutableService(type: serviceUUID, primary: true)
    service.characteristics = [inbox, out, status, control]

    outbox = out

    peripheral.removeAllServices()
    peripheral.add(service)
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    didAdd service: CBService,
    error: Error?
  ) {
    guard error == nil else {
      emit("onStateChange", ["state": "failed"])
      return
    }

    peripheral.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
      CBAdvertisementDataLocalNameKey: localName,
    ])
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic
  ) {
    guard characteristic.uuid == outboxUUID else { return }

    if !subscribers.contains(where: { $0.identifier == central.identifier }) {
      subscribers.append(central)
    }

    emit("onSubscribe", ["subscribed": true, "mtu": central.maximumUpdateValueLength])
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic
  ) {
    subscribers.removeAll { $0.identifier == central.identifier }
    // 아무도 안 듣는데 쌓아둬도 갈 곳이 없다
    if subscribers.isEmpty { backlog.removeAll() }

    emit("onSubscribe", ["subscribed": false, "mtu": 0])
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    didReceiveWrite requests: [CBATTRequest]
  ) {
    for request in requests {
      guard let value = request.value else { continue }
      emit("onReceive", ["data": value.base64EncodedString()])
    }

    // 답을 요구하는 쓰기에는 답해야 한다. 안 그러면 상대가 멈춘다.
    if let first = requests.first {
      peripheral.respond(to: first, withResult: .success)
    }
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    flush()
  }

  private func describe(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "on"
    case .poweredOff: return "off"
    case .unauthorized: return "denied"
    case .unsupported: return "unsupported"
    default: return "unknown"
    }
  }
}
