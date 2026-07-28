// Throwaway file proving the CI lint gate can go red. Never merged.
import { useState } from 'react';
export function CiSelfTest(cond: boolean) {
  if (cond) {
    const [a] = useState(0);
    return a;
  }
  return 0;
}
