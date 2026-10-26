import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../store/familyStore';
import {
  isTauri,
  isYrjFileEncrypted,
  takePendingAssociatedFiles,
  acknowledgeAssociatedFile,
  type AssociatedFileRequest,
} from '../utils/tauri';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import { beginProjectLoad, endProjectLoad } from '../store/projectLoadingStore';
import './AssociatedFileHandler.css';

interface PasswordRequest {
  path: string;
  error: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 接收 Windows 文件关联请求；YRP 打开工作区，YRJ 解包后打开。 */
export default function AssociatedFileHandler() {
  const navigate = useNavigate();
  const handledIds = useRef(new Set<number>());
  const openQueue = useRef<Promise<void>>(Promise.resolve());
  const passwordResolver = useRef<((password: string | null) => void) | null>(null);
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const completePath = useCallback((path: string, requestId: number) => {
    void acknowledgeAssociatedFile(requestId, path).catch(() => undefined);
  }, []);

  const requestPassword = useCallback((path: string, error: string): Promise<string | null> => {
    setPassword('');
    setShowPassword(false);
    setPasswordRequest({ path, error });
    return new Promise((resolve) => {
      passwordResolver.current = resolve;
    });
  }, []);

  const openPath = useCallback(async (path: string, requestId: number) => {
    let currentPath = path;
    let password: string | undefined;
    while (true) {
      setErrorMessage(null);
      try {
        const current = useFamilyStore.getState();
        if (current.project && current.isDirty) {
          await current.saveCurrentProject();
        }

        const isPackage = currentPath.toLowerCase().endsWith('.yrj');
        if (isPackage && password === undefined && await isYrjFileEncrypted(currentPath)) {
          const supplied = await requestPassword(currentPath, '');
          if (supplied === null) {
            completePath(path, requestId);
            return;
          }
          password = supplied;
          continue;
        }

        await beginProjectLoad(currentPath, isPackage ? 'unpack' : 'load');
        try {
          const opened = await current.openProjectFromFile(currentPath, password);
          if (opened) navigate('/tree');
          completePath(path, requestId);
          return;
        } finally {
          endProjectLoad();
        }
      } catch (error) {
        endProjectLoad(true);
        const message = errorText(error);
        if (message === 'PASSWORD_REQUIRED_OR_INCORRECT') {
          const workspacePath = (error as { workspacePath?: string }).workspacePath;
          currentPath = workspacePath || currentPath;
          const supplied = await requestPassword(
            currentPath,
            password === undefined ? '' : '密码错误，请重新输入。',
          );
          if (supplied === null) {
            completePath(path, requestId);
            return;
          }
          password = supplied;
          continue;
        }
        setErrorMessage(`打开工程失败：${message}`);
        completePath(path, requestId);
        return;
      }
    }
  }, [completePath, navigate, requestPassword]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;

    const receive = (request: AssociatedFileRequest) => {
      if (handledIds.current.has(request.id)) return;
      handledIds.current.add(request.id);
      request.paths.forEach((path) => {
        openQueue.current = openQueue.current.then(() => openPath(path, request.id));
      });
    };

    const initialize = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<AssociatedFileRequest>('associated-file-open', (event) => {
          receive(event.payload);
        });
        if (!active) {
          stop();
          return;
        }
        unlisten = stop;
        const pending = await takePendingAssociatedFiles();
        pending.forEach(receive);
      } catch (error) {
        if (active) setErrorMessage(`初始化文件打开功能失败：${errorText(error)}`);
      }
    };

    void initialize();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [openPath]);

  const hasModal = Boolean(passwordRequest || errorMessage);
  useEffect(() => {
    if (!hasModal) return;
    return lockBodyScroll();
  }, [hasModal]);

  const submitPassword = () => {
    if (!passwordRequest || !passwordResolver.current) return;
    const resolve = passwordResolver.current;
    passwordResolver.current = null;
    setPasswordRequest(null);
    resolve(password);
  };

  const cancelPassword = () => {
    if (!passwordRequest || !passwordResolver.current) return;
    const resolve = passwordResolver.current;
    passwordResolver.current = null;
    setPasswordRequest(null);
    resolve(null);
  };

  return (
    <>
      {passwordRequest && (
        <div className="modal-overlay">
          <div className="modal associated-open-dialog" role="dialog" aria-modal="true" aria-labelledby="associated-password-title">
            <div className="modal-header"><h3 id="associated-password-title">密码解锁</h3></div>
            <div className="modal-body">
              <p className="associated-open-path">{passwordRequest.path}</p>
              <div className="form-group">
                <label className="form-label" htmlFor="associated-open-password">该工程已受密码保护，请输入密码：</label>
                <div className="pw-wrap">
                  <input
                    id="associated-open-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="访问密码"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') submitPassword(); }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    title={showPassword ? '隐藏密码' : '显示密码'}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
                {passwordRequest.error && <p className="associated-open-error">{passwordRequest.error}</p>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={cancelPassword}>取消</button>
              <button className="btn btn-primary" onClick={submitPassword}>确定解锁</button>
            </div>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="modal-overlay">
          <div className="modal associated-open-dialog" role="alertdialog" aria-modal="true" aria-labelledby="associated-error-title">
            <div className="modal-header"><h3 id="associated-error-title">无法打开工程</h3></div>
            <div className="modal-body"><p className="associated-open-error">{errorMessage}</p></div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setErrorMessage(null)}>我知道了</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
