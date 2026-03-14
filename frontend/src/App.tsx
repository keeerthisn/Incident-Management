import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box, AppBar, Toolbar, Typography, Container } from '@mui/material';
import Dashboard from './components/Dashboard';
import TicketList from './components/TicketList';
import Analytics from './components/Analytics';
import Settings from './components/Settings';
import Navigation from './components/Navigation';
import GroupedIssues from './components/GroupedIssues';

/**
 * N-ABLE official logo mark:
 *  - Bold geometric "N" in white with a purple square accent on top-right
 *  - "N-ABLE" wordmark in white bold caps
 */
const NableLogo: React.FC = () => (
  <svg width="148" height="36" viewBox="0 0 148 36" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="N-ABLE">
    {/* ── N lettermark ── */}
    {/* Left vertical bar */}
    <rect x="0" y="4" width="7" height="28" rx="1" fill="#FFFFFF" />
    {/* Right vertical bar */}
    <rect x="19" y="4" width="7" height="28" rx="1" fill="#FFFFFF" />
    {/* Diagonal stroke (N crossbar) */}
    <polygon points="0,4 7,4 26,32 19,32" fill="#FFFFFF" />
    {/* Purple accent square — top-right of the N */}
    <rect x="16" y="4" width="10" height="10" rx="1" fill="#9B59FF" />

    {/* ── N-ABLE wordmark ── */}
    <text
      x="38"
      y="26"
      fontFamily="Inter,Arial Black,Arial,sans-serif"
      fontWeight="900"
      fontSize="19"
      fill="#FFFFFF"
      letterSpacing="1.5"
    >
      N-ABLE
    </text>
  </svg>
);

function App() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* ── Top bar — matches N-tranet dark nav ── */}
      <AppBar
        position="static"
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
            Incident Triage
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flexGrow: 1 }}>
        <Navigation />

        <Box component="main" sx={{ flexGrow: 1, p: 3, minWidth: 0, overflow: 'hidden' }}>
          <Container maxWidth="xl">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tickets" element={<TicketList />} />
              <Route path="/grouped" element={<GroupedIssues />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}

export default App;