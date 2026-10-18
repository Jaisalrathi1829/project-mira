const P = { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
export const IToday = () => <svg {...P}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>
export const ITasks = () => <svg {...P}><path d="M6 4.5h7M6 8h7M6 11.5h7" /><circle cx="3" cy="4.5" r=".6" /><circle cx="3" cy="8" r=".6" /><circle cx="3" cy="11.5" r=".6" /></svg>
export const ITimeline = () => <svg {...P}><path d="M2.5 4.5h7M5 8h8.5M2.5 11.5h5" /></svg>
export const ICal = () => <svg {...P}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" /></svg>
export const IDone = () => <svg {...P}><circle cx="8" cy="8" r="5.5" /><path d="M5.6 8.2l1.7 1.6 3.1-3.4" /></svg>
export const ISettings = () => <svg {...P}><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></svg>
export const IPlus = () => <svg {...P}><path d="M8 3.5v9M3.5 8h9" /></svg>
export const IBack = () => <svg {...P}><path d="M9.5 4L5.5 8l4 4" /></svg>
export const IClose = () => <svg {...P}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
export const IMail = () => <svg {...P} width={12} height={12}><rect x="2" y="3.5" width="12" height="9" rx="1.2" /><path d="M2.5 4.5L8 8.5l5.5-4" /></svg>
export const Check = ({ done, onClick, size = 16 }: { done: boolean; onClick?: (e: React.MouseEvent) => void; size?: number }) => (
  <button onClick={onClick} aria-label={done ? 'Mark incomplete' : 'Mark complete'}
    className={`shrink-0 rounded-full border grid place-items-center transition-colors duration-150 ${done ? 'bg-dark border-dark text-el' : 'border-mute hover:border-ink text-transparent hover:text-mute'}`}
    style={{ width: size, height: size }}>
    <svg width={size - 6} height={size - 6} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.2 5.2l1.8 1.7L7.8 3" /></svg>
  </button>
)
