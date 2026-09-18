const { withInfoPlist, withStringsXml } = require('expo/config-plugins')

/**
 * 홈 화면에 보이는 이름을 바꾼다. **속 이름은 그대로 둔다.**
 *
 * 앱이 메신저에 가까워져 이름을 SkyTalk 으로 바꿨다. 그런데 `name` 을
 * 바꾸면 iOS 프로젝트 폴더 이름과 안드로이드 패키지까지 따라 바뀌어
 * **두 폰에 새 앱으로 깔리고 대화가 통째로 사라진다.** 비행 전날 그럴 수는
 * 없다. 그래서 겉에 보이는 이름만 바꾼다.
 */
const DISPLAY_NAME = 'SkyTalk'

module.exports = function withDisplayName(config) {
  const withIos = withInfoPlist(config, mod => {
    mod.modResults.CFBundleDisplayName = DISPLAY_NAME
    return mod
  })

  return withStringsXml(withIos, mod => {
    const strings = mod.modResults.resources.string ?? []
    const existing = strings.find(entry => entry.$?.name === 'app_name')
    if (existing !== undefined) {
      existing._ = DISPLAY_NAME
    } else {
      strings.push({ $: { name: 'app_name' }, _: DISPLAY_NAME })
    }
    mod.modResults.resources.string = strings
    return mod
  })
}
