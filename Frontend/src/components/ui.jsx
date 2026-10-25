import { createContext, forwardRef, useCallback, useContext, useMemo, useState } from 'react';
import { CodeIcon } from './Icons';
import { colorForName } from '../colors';

export function Button({ variant = 'secondary', size = '', loading = false, className = '', children, ...props }) {
  return <button className={`cc-button ${variant} ${size} ${loading ? 'loading' : ''} ${className}`.trim()} disabled={loading || props.disabled} {...props}>
    {loading && <span className="cc-spinner" aria-hidden="true" />}{children}
  </button>;
}
export function IconButton({ children, label, ...props }) {
  return <button className="cc-icon-button cc-tooltip" aria-label={label} title={label} {...props}>{children}</button>;
}
export const Input = forwardRef(function Input({ label, error, ...props }, ref) {
  return <label className="cc-field">{label && <span>{label}</span>}<input ref={ref} className={`cc-input ${error ? 'error' : ''}`} {...props} />{error && <small className="cc-field-error">{error}</small>}</label>;
});
export function Select({ label, className = '', children, ...props }) {
  return <label className="cc-field">{label && <span>{label}</span>}<select className={`cc-select ${className}`.trim()} {...props}>{children}</select></label>;
}
export function Textarea({ label, ...props }) {
  return <label className="cc-field">{label && <span>{label}</span>}<textarea className="cc-textarea" {...props} /></label>;
}
export const Card = ({ className = '', children }) => <section className={`cc-card ${className}`}>{children}</section>;
export const Badge = ({ children }) => <span className="cc-badge">{children}</span>;
export function Avatar({ name = '' }) {
  const initials = name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  return <span className="cc-avatar" style={{ backgroundColor: colorForName(name) }} aria-label={name}>{initials}</span>;
}
export const Tooltip = ({ label, children }) => <span className="cc-tooltip" title={label}>{children}</span>;

const ToastContext = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((items) => [...items.slice(-3), { id, message }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3000);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return <ToastContext.Provider value={value}>{children}<div className="cc-toast-stack" aria-live="polite" aria-atomic="false">{toasts.map((item) => <div className="cc-toast" role="status" key={item.id}>{item.message}</div>)}</div></ToastContext.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext);
}
export function Logo() {
  return <div className="cc-logo"><img className="cc-logo-mark" src="/logo.png" alt="" /><span>PairPad</span></div>;
}
export function Splitter({ direction = 'vertical', size, onChange, onReset, min = 15, max = 85 }) {
  const horizontal = direction === 'horizontal';
  const start = (event) => {
    event.preventDefault();
    const origin = horizontal ? event.clientY : event.clientX;
    const initial = size;
    const move = (next) => onChange(Math.min(max, Math.max(min, initial + (next - origin) / (horizontal ? window.innerHeight : window.innerWidth) * 100)));
    const onMove = (e) => move(horizontal ? e.clientY : e.clientX);
    const stop = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
  };
  const key = (event) => {
    if (event.key === 'Home') onReset();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') onChange(Math.max(min, size - 2));
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') onChange(Math.min(max, size + 2));
  };
  return <div className={`cc-splitter ${horizontal ? 'horizontal' : 'vertical'}`} role="separator" tabIndex="0" aria-valuenow={size} onPointerDown={start} onDoubleClick={onReset} onKeyDown={key} />;
}
export const FeatureIcon = ({ type }) => type === 'code' ? <CodeIcon /> : <span aria-hidden="true">✦</span>;
