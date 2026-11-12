import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import App from './App.jsx';
import { ColorModeContext } from './colorMode.js';

function readPref(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function frosted(dark, strength) {
  return {
    backgroundColor: dark ? `rgba(22, 25, 33, ${strength})` : `rgba(255, 255, 255, ${strength})`,
    backgroundImage: 'none',
    backdropFilter: 'blur(22px) saturate(160%)',
    WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.6)'}`,
  };
}

function pane(dark) {
  return {
    backgroundColor: dark ? 'rgba(15, 17, 23, 0.28)' : 'rgba(255, 255, 255, 0.24)',
    backgroundImage: 'none',
    border: `1px solid ${dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255, 255, 255, 0.45)'}`,
    boxShadow: 'none',
  };
}

function buildTheme(mode, glass) {
  const dark = mode === 'dark';
  const theme = createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#60a5fa' : '#1d4ed8' },
      secondary: { main: dark ? '#a78bfa' : '#7c3aed' },
      background: dark ? { default: '#0f1115', paper: '#171a21' } : { default: '#f5f7fb', paper: '#ffffff' },
    },
    shape: { borderRadius: glass ? 16 : 10 },
    typography: { fontFamily: 'Roboto, Helvetica, Arial, sans-serif' },
    components: {
      MuiCssBaseline: glass ? { styleOverrides: { body: { backgroundColor: 'transparent' } } } : {},
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: ({ theme: t }) => (glass ? pane(dark) : { border: `1px solid ${t.palette.divider}`, backgroundImage: 'none' }) },
      },
      MuiAppBar: { styleOverrides: { root: glass ? { ...frosted(dark, 0.55), borderTop: 'none', borderLeft: 'none', borderRight: 'none' } : { border: 'none' } } },
      MuiDialog: { styleOverrides: { paper: glass ? frosted(dark, 0.82) : {} } },
      MuiPopover: { styleOverrides: { paper: glass ? frosted(dark, 0.88) : {} } },
      MuiMenu: { styleOverrides: { paper: glass ? frosted(dark, 0.9) : {} } },
      MuiDrawer: { styleOverrides: { paper: glass ? frosted(dark, 0.94) : {} } },
      MuiAccordion: { styleOverrides: { root: glass ? { '&::before': { display: 'none' } } : {} } },
    },
  });
  theme.glass = glass;
  return theme;
}

function Root() {
  const [mode, setMode] = useState(() => readPref('color-mode', ['light', 'dark'], 'light'));
  const [glass, setGlass] = useState(() => readPref('glass-ui', ['on', 'off'], 'off') === 'on');
  const value = useMemo(
    () => ({
      mode,
      glass,
      toggle: () =>
        setMode((m) => {
          const next = m === 'dark' ? 'light' : 'dark';
          writePref('color-mode', next);
          return next;
        }),
      setGlass: (on) => {
        writePref('glass-ui', on ? 'on' : 'off');
        setGlass(on);
      },
    }),
    [mode, glass]
  );
  const theme = useMemo(() => buildTheme(mode, glass), [mode, glass]);
  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
