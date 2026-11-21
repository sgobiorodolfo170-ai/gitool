import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：确认按钮使用错误色，并由调用方决定文案后果。 */
  danger?: boolean;
};

type ConfirmHandler = (options: ConfirmOptions) => Promise<boolean>;

/**
 * 模块级注册表，让 hooks（useProjects / useImportFlow / useRemotes）
 * 也能调用确认框，而不必把 confirm 函数逐层注入。
 *
 * 为什么允许单例：本应用是单窗口桌面应用；若未来支持多窗口，
 * 应改为按 webContents 注入。未注册时回退到原生 confirm，保证
 * 浏览器预览与单元测试仍可用。
 */
let registeredHandler: ConfirmHandler | null = null;

export function registerConfirmHandler(handler: ConfirmHandler): () => void {
  registeredHandler = handler;
  return () => {
    if (registeredHandler === handler) registeredHandler = null;
  };
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (registeredHandler) return registeredHandler(options);
  const fallback = options.description
    ? `${options.title}\n\n${options.description}`
    : options.title;
  return Promise.resolve(window.confirm(fallback));
}

const ConfirmContext = createContext<ConfirmHandler | null>(null);

export function useConfirm(): ConfirmHandler {
  const handler = useContext(ConfirmContext);
  if (!handler) throw new Error("useConfirm 必须在 ConfirmProvider 内使用");
  return handler;
}

/**
 * 确认对话框宿主：挂一次，全应用共享。
 *
 * 交互约定：
 * - 初始焦点进入对话框（取消按钮所在的可聚焦序列）；
 * - Tab 在对话框内循环，不逃逸到背景；
 * - Escape / 点击遮罩 / 取消 → false；
 * - 确认 → true；
 * - 关闭后焦点回到触发前的元素（由 useFocusTrap 负责）。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmHandler>(
    (nextOptions) =>
      new Promise<boolean>((resolve) => {
        // 前一个未决请求不应被静默丢弃：先按“取消”结算，避免 Promise 悬挂
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        setOptions(nextOptions);
      }),
    [],
  );

  useEffect(() => registerConfirmHandler(confirm), [confirm]);

  const settle = useCallback((value: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setOptions(null);
    resolve?.(value);
  }, []);

  const dialogRef = useFocusTrap<HTMLDivElement>(options !== null, () => settle(false));

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) settle(false);
          }}
        >
          <div
            className="modal-panel confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby={options.description ? "confirm-dialog-description" : undefined}
            ref={dialogRef}
          >
            <div className="modal-heading">
              <div>
                <h2 id="confirm-dialog-title">{options.title}</h2>
                {options.description && (
                  <span id="confirm-dialog-description">{options.description}</span>
                )}
              </div>
              <AlertTriangle
                size={18}
                aria-hidden="true"
                className={options.danger ? "confirm-icon danger" : "confirm-icon"}
              />
            </div>
            <div className="form-body confirm-actions">
              <button className="button secondary" onClick={() => settle(false)}>
                {options.cancelLabel ?? "取消"}
              </button>
              <button
                className={`button ${options.danger ? "danger" : "primary"}`}
                onClick={() => settle(true)}
              >
                {options.confirmLabel ?? "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
