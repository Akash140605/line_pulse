import React from 'react';
import logoNavy from '../assets/dixon-logo.png';
import logoWhite from '../assets/dixon-logo-white.png';

/**
 * The Dixon logo (src/assets): navy "Dixon" with the red square on a light background, white "Dixon" with the red
 * square on a dark one (sidebar, login backdrop). The height comes from className, the width follows (≈ 7.3 : 1).
 */
export default function DixonLogo({ white = false, className = 'h-6' }) {
  return <img src={white ? logoWhite : logoNavy} alt="Dixon" draggable={false} className={`${className} w-auto max-w-none select-none`} />;
}

/** The small "D" mark for tight spots (collapsed sidebar). */
export function DixonMark({ className = 'h-9 w-9' }) {
  return (
    <span aria-label="Dixon" role="img" className={`${className} relative grid shrink-0 place-items-center rounded-lg bg-white`}>
      <span className="lp-brand text-fs-20 font-black leading-none" style={{ color: '#231F76', fontStretch: '125%' }}>D</span>
      <span className="absolute right-[7px] top-[7px] h-[5px] w-[7px]" style={{ background: '#ED1C24' }} aria-hidden />
    </span>
  );
}
