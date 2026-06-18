// Bridge R3F JSX types to React 19's React.JSX namespace.
// R3F 8.x augments the legacy global JSX namespace; @types/react@19 uses React.JSX.
import type { ThreeElements } from '@react-three/fiber';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
