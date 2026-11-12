import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { GlobalStyles } from '@mui/material';
import { AppBar, Toolbar, Typography, Tabs, Tab, Box, IconButton, Tooltip, CircularProgress, Container, Stack } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import HomeIcon from '@mui/icons-material/Home';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SettingsIcon from '@mui/icons-material/Settings';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { AuthProvider, useAuth } from './auth.jsx';
import { useColorMode } from './colorMode.js';
import Logo from './components/Logo.jsx';
import GlassLayer from './components/GlassLayer.jsx';
import LoginPage from './pages/LoginPage.jsx';
import HomePage from './pages/HomePage.jsx';
import SatsPage from './pages/SatsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import TestRunner from './pages/TestRunner.jsx';
import ResultsPage from './pages/ResultsPage.jsx';
import TakersPage from './pages/TakersPage.jsx';

export function ModeToggle() {
  const { mode, toggle } = useColorMode();
  return (
    <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
      <IconButton onClick={toggle}>{mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}</IconButton>
    </Tooltip>
  );
}

function Shell({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = [
    { to: '/', label: 'Home', icon: <HomeIcon fontSize="small" /> },
    { to: '/sats', label: 'SATs', icon: <AssignmentIcon fontSize="small" /> },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon fontSize="small" /> },
  ];
  if (user.isAdmin) tabs.push({ to: '/admin', label: 'Admin', icon: <AdminPanelSettingsIcon fontSize="small" /> });
  const current = tabs.findIndex((t) => (t.to === '/' ? location.pathname === '/' : location.pathname.startsWith(t.to)));
  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="sticky" color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Logo size={30} />
            <Typography variant="h6" fontWeight={700} sx={{ display: { xs: 'none', md: 'block' } }}>Luca's SAT</Typography>
          </Stack>
          <Tabs value={current === -1 ? false : current} onChange={(e, v) => navigate(tabs[v].to)} variant="scrollable" scrollButtons="auto" sx={{ flexGrow: 1, ml: { xs: 0, md: 2 } }}>
            {tabs.map((t) => (
              <Tab key={t.to} icon={t.icon} iconPosition="start" label={t.label} sx={{ minHeight: 64 }} />
            ))}
          </Tabs>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>{user.username}</Typography>
          <ModeToggle />
          <Tooltip title="Sign out">
            <IconButton onClick={logout}>
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>{children}</Container>
    </Box>
  );
}

function Backdrop({ image, animated }) {
  const { glass, mode } = useColorMode();
  if (glass) return <GlassLayer image={image} animated={animated} mode={mode} />;
  if (!image) return null;
  return (
    <GlobalStyles
      styles={{
        body: {
          backgroundImage: `url("${image}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed',
          minHeight: '100vh',
        },
      }}
    />
  );
}

function Routed() {
  const { user } = useAuth();
  if (user === undefined) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!user) {
    return (
      <>
        <Backdrop image={null} />
        <LoginPage />
      </>
    );
  }
  return (
    <>
    <Backdrop image={user.background} animated={user.backgroundAnimated} />
    <Routes>
      <Route path="/test/:id" element={<TestRunner />} />
      <Route path="/" element={<Shell><HomePage /></Shell>} />
      <Route path="/sats" element={<Shell><SatsPage /></Shell>} />
      <Route path="/results/:id" element={<Shell><ResultsPage /></Shell>} />
      <Route path="/takers/:id" element={<Shell><TakersPage /></Shell>} />
      <Route path="/settings" element={<Shell><SettingsPage /></Shell>} />
      <Route path="/admin" element={user.isAdmin ? <Shell><AdminPage /></Shell> : <Navigate to="/" />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}
