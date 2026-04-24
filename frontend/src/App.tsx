import React, { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box, AppBar, Toolbar, Typography, Container, Button } from '@mui/material';
import Dashboard from './components/Dashboard';
import TicketList from './components/TicketList';
import Analytics from './components/Analytics';
import Settings from './components/Settings';
import Navigation from './components/Navigation';
import GroupedIssues from './components/GroupedIssues';
import Login from './components/Login';
import RootCauseAnalyzer from './components/RootCauseAnalyzer';
import ResolutionAssistant from './components/ResolutionAssistant';
import CaseTracker from './components/CaseTracker';

const NableLogo: React.FC = () => (
  <Box
    component="img"
    src="/logo-nable-wordmark.svg"
    alt="N-able"
    onError={(event: React.SyntheticEvent<HTMLImageElement, Event>) => {
      event.currentTarget.onerror = null;
      event.currentTarget.src = '/logo-nable.svg';
    }}
    sx={{
      width: 132,
      height: 38,
      display: 'block',
      flexShrink: 0,
      objectFit: 'contain',
      objectPosition: 'center',
    }}
  />
);

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => sessionStorage.getItem('isLoggedIn') === 'true');

  const handleLogin = () => {
    sessionStorage.setItem('isLoggedIn', 'true');
    setIsLoggedIn(true);
  };

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* ── Top bar — matches N-tranet dark nav ── */}
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: '#1A1A2E',
          borderBottom: '4px solid #7C3AED',
          zIndex: (theme) => theme.zIndex.drawer + 1,
        }}
      >
        <Toolbar sx={{ gap: 2, minHeight: 56 }}>
          <NableLogo />

          <Box sx={{ width: '1px', height: 28, bgcolor: 'rgba(255,255,255,0.15)' }} />

          <Typography
            variant="subtitle1"
            sx={{ color: 'rgba(255,255,255,0.80)', fontWeight: 500, flexGrow: 1, letterSpacing: '0.02em' }}
          >
            Incident Management
          </Typography>

          <Button
            variant="outlined"
            size="small"
            onClick={() => setIsLoggedIn(false)}
            sx={{
              color: '#FFFFFF',
              borderColor: 'rgba(255,255,255,0.3)',
              '&:hover': {
                borderColor: '#FFFFFF',
                bgcolor: 'rgba(255,255,255,0.1)',
              },
            }}
          >
            Sign Out
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flexGrow: 1 }}>
        <Navigation />

        <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0, overflow: 'hidden' }}>
          <Container maxWidth="xl">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tickets" element={<TicketList />} />
              <Route path="/case-tracker" element={<CaseTracker />} />
              <Route path="/grouped" element={<GroupedIssues />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/root-cause-analyzer" element={<RootCauseAnalyzer />} />
              <Route path="/resolution-assistant" element={<ResolutionAssistant />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}

export default App;