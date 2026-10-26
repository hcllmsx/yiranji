; NSIS 安装器自定义 hook
; 覆盖安装窗口标题：从默认的 "以苒纪 Setup" 改为 "以苒纪 v26.7.3 Setup"
; 版本号由 scripts/sync-version.mjs 自动同步
Caption "以苒纪 v26.10.26"

; 扩展名、ProgID 和打开命令由 Tauri fileAssociations 统一注册；
; 此处只覆盖各 ProgID 的 DefaultIcon，避免写入重复的关联或卸载逻辑。
; 必须在 include 时展开 __FILEDIR__；宏展开时它会指向生成的 installer.nsi。
!define YIRANJI_ICON_SOURCE_DIR "${__FILEDIR__}\icons"
Var YiranjiYrpAssociation
Var YiranjiYrjAssociation

!macro NSIS_HOOK_POSTINSTALL
  SetOutPath "$INSTDIR"
  File "/oname=yrp.ico" "${YIRANJI_ICON_SOURCE_DIR}\yrp.ico"
  File "/oname=yrj.ico" "${YIRANJI_ICON_SOURCE_DIR}\yrj.ico"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Yiranji.Project\DefaultIcon" "" "$\"$INSTDIR\yrp.ico$\",0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Yiranji.Package\DefaultIcon" "" "$\"$INSTDIR\yrj.ico$\",0"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\yrp.ico"
  Delete "$INSTDIR\yrj.ico"
  ; Tauri 的 APP_UNASSOCIATE 会恢复安装时备份；先记录当前归属，
  ; 以便用户已改绑其他应用时，在内置清理后恢复原关联。
  ReadRegStr $YiranjiYrpAssociation SHELL_CONTEXT "Software\Classes\.yrp" ""
  ReadRegStr $YiranjiYrjAssociation SHELL_CONTEXT "Software\Classes\.yrj" ""
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $YiranjiYrpAssociation == ""
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.yrp" ""
  ${ElseIf} $YiranjiYrpAssociation != "Yiranji.Project"
    WriteRegStr SHELL_CONTEXT "Software\Classes\.yrp" "" "$YiranjiYrpAssociation"
  ${EndIf}
  ${If} $YiranjiYrjAssociation == ""
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.yrj" ""
  ${ElseIf} $YiranjiYrjAssociation != "Yiranji.Package"
    WriteRegStr SHELL_CONTEXT "Software\Classes\.yrj" "" "$YiranjiYrjAssociation"
  ${EndIf}
  !insertmacro UPDATEFILEASSOC
!macroend
