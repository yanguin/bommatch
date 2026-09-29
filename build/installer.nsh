; 安装时版本检查已移除（2026-09-29）
; 原因：version.txt 已改为 JSON 格式，原检查按纯文本比对版本号，会误判并拦截新版本安装
;       （如 1.4.0 安装包被误判为旧版本）。
; 版本防线现由应用启动时的 license-checker.js（可正确解析 JSON）与 electron-updater 接管。
; 如需恢复安装时检查，请先让检查逻辑支持 JSON 格式的 version.txt。
!macro customInit
!macroend
