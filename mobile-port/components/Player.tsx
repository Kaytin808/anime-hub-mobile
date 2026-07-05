import React from 'react';

export default function Player({ src }: { src: string }) {
  return (
    <div>
      <video controls style={{ width: 800, maxWidth: '100%' }} src={src} />
    </div>
  );
}
