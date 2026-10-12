import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BLE_UUIDS } from '@/infrastructure/transport/ble/bleModule'

/**
 * 알리는 쪽 세 군데가 어긋나지 않았는지.
 *
 * 같은 일을 **세 언어로 따로** 적어뒀다. Swift(아이폰), Kotlin(안드로이드),
 * TypeScript(둘을 부르는 쪽). 번호 한 글자나 이름 한 글자가 달라도
 * **오류 없이 그냥 못 만난다.** 찾는 쪽은 영원히 못 찾고, 화면에는
 * "상대를 못 찾았다" 로만 보인다.
 *
 * 비행기 안에서 이걸 알아챌 방법이 없다. 그림이나 전파와 달리 이건
 * 글자 맞춰보기로 잡을 수 있다.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const moduleRoot = join(root, 'modules', 'ble-peripheral')

const swift = readFileSync(join(moduleRoot, 'ios', 'BlePeripheralModule.swift'), 'utf8')
const kotlin = readFileSync(
  join(
    moduleRoot,
    'android',
    'src',
    'main',
    'java',
    'com',
    'ybbarng',
    'skytalk',
    'bleperipheral',
    'BlePeripheralModule.kt',
  ),
  'utf8',
)
const config = JSON.parse(
  readFileSync(join(moduleRoot, 'expo-module.config.json'), 'utf8'),
)

describe('세 곳이 같은 번호를 쓴다', () => {
  const named = [
    ['service', BLE_UUIDS.service],
    ['inbox', BLE_UUIDS.inbox],
    ['outbox', BLE_UUIDS.outbox],
    ['status', BLE_UUIDS.status],
    ['control', BLE_UUIDS.control],
  ] as const

  for (const [what, uuid] of named) {
    it(`${what} 번호가 아이폰·안드로이드·JS 에서 같다`, () => {
      // Swift 는 소문자 그대로, Kotlin 도 그대로 적어뒀다
      expect(swift).toContain(uuid)
      expect(kotlin).toContain(uuid)
    })
  }
})

describe('두 폰에 같은 이름으로 붙는다', () => {
  it('설정이 두 운영체제를 다 적는다', () => {
    expect(config.platforms).toContain('ios')
    expect(config.platforms).toContain('android')
  })

  it('안드로이드 클래스 이름이 실제 코드와 맞는다', () => {
    const declared: string[] = config.android.modules
    expect(declared).toContain('com.ybbarng.skytalk.bleperipheral.BlePeripheralModule')

    // 패키지와 클래스가 선언과 같은지 본다. 한 글자만 달라도
    // 자동 연결이 조용히 건너뛴다.
    expect(kotlin).toContain('package com.ybbarng.skytalk.bleperipheral')
    expect(kotlin).toContain('class BlePeripheralModule')
  })

  it('JS 가 찾는 이름을 두 쪽 다 내건다', () => {
    // `requireNativeModule('BlePeripheral')` 이 이걸 찾는다
    expect(swift).toContain('Name("BlePeripheral")')
    expect(kotlin).toContain('Name("BlePeripheral")')
  })
})

describe('두 쪽이 같은 일을 할 수 있다', () => {
  const promised = ['isSupported', 'start', 'stop', 'send', 'isAdvertising']

  for (const name of promised) {
    it(`${name} 이 두 쪽 다 있다`, () => {
      // 하나만 있으면 그 폰에서만 터진다. 우리 둘은 폰이 서로 달라서
      // **한쪽에서만 나는 버그**가 가장 찾기 어렵다.
      expect(swift).toContain(`"${name}"`)
      expect(kotlin).toContain(`"${name}"`)
    })
  }

  const events = ['onReceive', 'onStateChange', 'onSubscribe']

  for (const name of events) {
    it(`${name} 을 두 쪽 다 보낸다`, () => {
      expect(swift).toContain(`"${name}"`)
      expect(kotlin).toContain(`"${name}"`)
    })
  }
})

describe('역할을 운영체제로 가르지 않는다', () => {
  const transport = readFileSync(
    join(root, 'src', 'infrastructure', 'transport', 'ble', 'BleMessageTransport.ts'),
    'utf8',
  )

  it('Platform 을 아예 들여오지 않는다', () => {
    // **여기가 이 파일의 핵심이다.**
    //
    // 운영체제로 가르면 두 가지가 막힌다. 아이폰이 뒤로 갔을 때
    // 다시 못 찾고, 안드로이드 두 대면 둘 다 찾기만 하다 영영 못 만난다.
    //
    // 주석에는 `Platform.OS` 라는 말이 왜 안 쓰는지 설명하느라 남아
    // 있다. 그래서 글자가 아니라 **들여오는지**를 본다.
    expect(transport).not.toMatch(/^import .*\bPlatform\b.*from 'react-native'/m)
  })

  it('맡은 역할로 가른다', () => {
    expect(transport).toMatch(/linkRole === 'host' \? 'advertiser' : 'scanner'/)
  })
})
