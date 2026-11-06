/**
 * GPX delivery (E6.2): Blob download everywhere, Web Share API on mobile
 * (iOS Safari has no meaningful download UX). Returns the delivery method.
 */
import { gpxFileName } from './gpx';

export type Delivery = 'download' | 'share' | 'failed';

export async function deliverGpx(gpx: string, name: string): Promise<Delivery> {
  const fileName = gpxFileName(name);
  const file = new File([gpx], fileName, { type: 'application/gpx+xml' });

  // Web Share Level 2 (mobile): share the file directly
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'share';
    } catch {
      // user cancelled or share failed — fall through to download
    }
  }

  try {
    const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    return 'download';
  } catch {
    return 'failed';
  }
}
