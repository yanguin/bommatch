; 自定义 NSIS 脚本：安装时校验是否为最新版本
; 通过 electron-builder 的 nsis.include 配置引入，customInit 宏在 .onInit 中执行
; 若安装包版本低于 Gitee 上 version.txt 中的最新版本，则弹出提示并中止安装
;
; 注意：electron-builder 分两遍编译 NSIS（卸载器遍 BUILD_UNINSTALLER 已定义、安装器遍未定义）。
; customInit 仅在安装器遍展开，因此内部逻辑必须全部内联在宏中，
; 不能定义独立 Function（否则在卸载器遍会被判定为未引用函数，触发 warning 6010 视为错误）。

!include "WordFunc.nsh"

!macro customInit
  ; 从 Gitee 拉取 version.txt 中的最新版本号
  InitPluginsDir
  inetc::get /silent "https://gitee.com/yanguin/bommatch/raw/master/version.txt" "$PLUGINSDIR\latest_version.txt" /END
  Pop $0
  StrCpy $1 ""
  ${If} $0 == "OK"
    ClearErrors
    FileOpen $0 "$PLUGINSDIR\latest_version.txt" r
    ${If} ${Errors}
      ClearErrors
    ${Else}
      FileRead $0 $1
      FileClose $0
    ${EndIf}
  ${EndIf}

  ; 去除读取到的版本号末尾的 $\r 与 $\n
  viiyong_trim_loop:
    StrCpy $2 "$1" 1 -1
    StrCmp $2 "$\n" viiyong_trim_strip
    StrCmp $2 "$\r" viiyong_trim_strip
    Goto viiyong_trim_done
  viiyong_trim_strip:
    StrCpy $1 "$1" -1
    Goto viiyong_trim_loop
  viiyong_trim_done:

  ; 比对版本：安装包版本低于最新版本时阻止安装
  ; 拉取失败或读取为空时放行，避免远端不可达导致无法安装
  ${If} $1 != ""
    ${VersionCompare} "${VERSION}" "$1" $0
    ; $0: 0=相等, 1=安装包较旧, 2=安装包较新
    ${If} $0 == 1
      MessageBox MB_OK|MB_ICONEXCLAMATION "该版本不是最新版本，请联系制作者获取安装包"
      Abort
    ${EndIf}
  ${EndIf}
!macroend
