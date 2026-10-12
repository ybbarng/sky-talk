import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import type { FileSharer, FileStore, Hasher } from '@/application/ports/FileStore'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'
import { sha256Hex } from './Sha256'

/**
 * 기기에 파일을 쓰고 읽는다.
 *
 * **여기서 예외가 위로 새면 안 된다.** 저장 공간이 없거나 권한이
 * 없을 때 터지는데, 그것 때문에 앱이 죽으면 대화까지 못 하게 된다.
 * 전부 잡아서 `Result` 로 바꾼다.
 *
 * (docs/05-messaging-spec.md 6장 · T19)
 */
export class ExpoFileStore implements FileStore {
  documentsPath(): string {
    // 아이폰에서 파일 앱으로 꺼낼 수 있는 자리다
    return FileSystem.documentDirectory ?? ''
  }

  cachePath(): string {
    return FileSystem.cacheDirectory ?? ''
  }

  async write(path: string, content: string): Promise<Result<void, DomainError>> {
    try {
      await FileSystem.writeAsStringAsync(path, content)
      return ok(undefined)
    } catch (cause) {
      return err(wrap(cause, '파일을 쓰지 못했다'))
    }
  }

  /**
   * 조각조각 이어 쓴다.
   *
   * `expo-file-system` 은 이어 쓰기를 직접 주지 않는다. 그래서 어느
   * 크기만큼 모았다가 한 번씩 덧붙인다. **만 건을 통째로 문자열로
   * 만들지 않는 것이 목적이라** 이 정도면 충분하다.
   */
  async writeStream(
    path: string,
    chunks: AsyncIterable<string>,
  ): Promise<Result<void, DomainError>> {
    try {
      // 처음엔 비운다. 예전 것이 남아 있으면 뒤에 붙어 버린다.
      await FileSystem.writeAsStringAsync(path, '')

      let buffer = ''
      for await (const chunk of chunks) {
        buffer += chunk

        if (buffer.length >= FLUSH_AT) {
          await append(path, buffer)
          buffer = ''
        }
      }

      if (buffer.length > 0) await append(path, buffer)
      return ok(undefined)
    } catch (cause) {
      return err(wrap(cause, '파일을 쓰지 못했다'))
    }
  }

  async read(path: string): Promise<Result<string, DomainError>> {
    try {
      return ok(await FileSystem.readAsStringAsync(path))
    } catch (cause) {
      return err(wrap(cause, '파일을 읽지 못했다'))
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const info = await FileSystem.getInfoAsync(path)
      return info.exists
    } catch {
      return false
    }
  }

  async list(directory: string): Promise<Result<string[], DomainError>> {
    try {
      return ok(await FileSystem.readDirectoryAsync(directory))
    } catch (cause) {
      return err(wrap(cause, '폴더를 읽지 못했다'))
    }
  }

  async remove(path: string): Promise<Result<void, DomainError>> {
    try {
      await FileSystem.deleteAsync(path, { idempotent: true })
      return ok(undefined)
    } catch (cause) {
      return err(wrap(cause, '파일을 지우지 못했다'))
    }
  }

  async makeDirectory(path: string): Promise<Result<void, DomainError>> {
    try {
      await FileSystem.makeDirectoryAsync(path, { intermediates: true })
      return ok(undefined)
    } catch (cause) {
      return err(wrap(cause, '폴더를 만들지 못했다'))
    }
  }

  async sizeOf(path: string): Promise<Result<number, DomainError>> {
    try {
      const info = await FileSystem.getInfoAsync(path)
      return ok(info.exists && 'size' in info ? info.size : 0)
    } catch (cause) {
      return err(wrap(cause, '파일 크기를 읽지 못했다'))
    }
  }
}

/** 이만큼 모이면 한 번 덧붙인다 */
const FLUSH_AT = 64 * 1024

async function append(path: string, text: string): Promise<void> {
  const before = await FileSystem.readAsStringAsync(path)
  await FileSystem.writeAsStringAsync(path, before + text)
}

/**
 * 파일을 바깥으로 내보내고 들여온다.
 *
 * 어디로 보낼지는 사용자가 고른다. 메일이든 에어드롭이든 파일 앱이든
 * 기기가 주는 길을 그대로 쓴다. **우리가 어딘가로 올리지 않는다.**
 * 비행기에 인터넷이 없기도 하고, 대화를 바깥으로 내보낼 이유도 없다.
 */
export class ExpoFileSharer implements FileSharer {
  async share(paths: readonly string[]): Promise<Result<void, DomainError>> {
    try {
      const canShare = await Sharing.isAvailableAsync()
      if (!canShare) {
        return err(
          domainError('not-found', '이 기기에서는 파일을 내보낼 수 없다', 'share'),
        )
      }

      // 한 번에 하나씩만 된다. 차례로 띄운다.
      for (const path of paths) {
        await Sharing.shareAsync(path)
      }
      return ok(undefined)
    } catch (cause) {
      return err(wrap(cause, '파일을 내보내지 못했다'))
    }
  }

  async pick(): Promise<Result<string | null, DomainError>> {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        // 우리 파일은 확장자가 .skytalk.json 이라 기기가 종류를 모른다.
        // 전부 보여주고 형식 검사는 우리가 한다.
        type: '*/*',
        copyToCacheDirectory: true,
      })

      if (picked.canceled) return ok(null)
      return ok(picked.assets[0]?.uri ?? null)
    } catch (cause) {
      return err(wrap(cause, '파일을 고르지 못했다'))
    }
  }
}

/** 요약값. 순수 계산이라 기기 모듈이 필요 없다 */
export class LocalHasher implements Hasher {
  async sha256(value: string): Promise<Result<string, DomainError>> {
    try {
      return ok(sha256Hex(value))
    } catch (cause) {
      return err(wrap(cause, '요약값을 만들지 못했다'))
    }
  }
}

function wrap(cause: unknown, what: string): DomainError {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return domainError('invalid-value', `${what}: ${detail}`, 'file')
}
