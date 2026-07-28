// Throwaway: proves branch protection blocks a PR whose required check is red.
// Never merged. Deleted immediately after the reading is taken.
import { useState } from 'react';
export function ProtectionSelfTest(cond: boolean) {
  if (cond) {
    const [a] = useState(0);
    return a;
  }
  return 0;
}
