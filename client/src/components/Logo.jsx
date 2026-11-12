import { Box } from '@mui/material';

export default function Logo({ size = 32 }) {
  return <Box component="img" src="/walnut.png" alt="Luca's SAT" sx={{ width: size, height: size, display: 'block', filter: (t) => (t.palette.mode === 'dark' ? 'invert(1)' : 'none') }} />;
}
