Pod::Spec.new do |s|
  s.name           = 'BlePeripheral'
  s.version        = '1.0.0'
  s.summary        = '아이폰이 블루투스로 자기를 알린다'
  s.description    = '핫스팟을 못 쓸 때 글로라도 대화하기 위한 알리는 쪽 구현'
  s.author         = ''
  s.homepage       = 'https://github.com/ybbarng/sky-talk'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
