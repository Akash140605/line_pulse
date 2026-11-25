import React from 'react';

/** Thin animated bar pinned to the top while any request is in flight. */
export default function LoadingBar({ active }) {
  return (
    <div className={`fixed top-0 inset-x-0 z-[60] h-1 overflow-hidden transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}>
      <div className="h-full w-1/3 bg-gradient-to-r from-sky-400 via-blue-600 to-red-600 animate-[slide_1s_ease-in-out_infinite]" />
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}
