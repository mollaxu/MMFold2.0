export default function AppHeader({ activePage = 'server' }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-left">
          <a href="#" className="app-logo">
            <img src="/logo.svg" alt="MMFold" className="app-logo-img" />
            <span className="app-logo-text">MMFold Server</span>
          </a>
          <nav className="app-nav">
            <a href="#" className="app-nav-link active">
              Server
              <span className="app-nav-underline" />
            </a>
          </nav>
        </div>
        <div className="app-header-right">
          <div className="app-avatar" />
        </div>
      </div>
    </header>
  )
}
