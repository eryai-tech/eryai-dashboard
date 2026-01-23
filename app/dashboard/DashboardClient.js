'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'
import PushNotificationSettings from '@/app/components/PushNotificationSettings'
import AdminSettings from '@/app/components/AdminSettings'

export default function DashboardClient({ 
  user, 
  isSuperadmin, 
  customerId,
  customerName,
  customerPlan = 'starter',
  userRole = 'member',
  initialSessions, 
  customers 
}) {
  const [sessions, setSessions] = useState(initialSessions)
  const [selectedSession, setSelectedSession] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [filterCustomer, setFilterCustomer] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState('chats')
  const [showOnlyUnread, setShowOnlyUnread] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  const [showActionMenu, setShowActionMenu] = useState(null)
  const [showEscalateModal, setShowEscalateModal] = useState(null)
  const [teamMembers, setTeamMembers] = useState([])
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false)
  const actionMenuRef = useRef(null)
  const router = useRouter()
  const supabase = createClient()

  // Check if user can access admin
  const canAccessAdmin = isSuperadmin || userRole === 'admin' || userRole === 'owner'

  // Show filter if user has access to multiple customers
  const showCustomerFilter = customers && customers.length > 1

  // Close action menu on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setShowActionMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fetch team members when escalate modal opens
  useEffect(() => {
    if (showEscalateModal) {
      fetchTeamMembers()
    }
  }, [showEscalateModal])

  const fetchTeamMembers = async () => {
    setLoadingTeamMembers(true)
    try {
      const response = await fetch(`/api/admin/users?customer_id=${customerId || ''}`)
      const data = await response.json()
      if (data.users) {
        // Filter out current user and format for display
        const members = data.users
          .filter(u => u.user_id !== user.id && !u.is_invite)
          .map(u => ({
            id: u.user_id,
            email: u.email,
            name: u.email?.split('@')[0] || 'Användare',
            role: u.role,
            team_name: u.team_name,
            type: 'user'
          }))
        
        // Also fetch teams
        const teamsResponse = await fetch(`/api/admin/teams?customer_id=${customerId || ''}`)
        const teamsData = await teamsResponse.json()
        const teams = (teamsData.teams || []).map(t => ({
          id: t.id,
          name: t.name,
          member_count: t.member_count,
          type: 'team'
        }))

        setTeamMembers([...teams, ...members])
      }
    } catch (err) {
      console.error('Failed to fetch team members:', err)
    } finally {
      setLoadingTeamMembers(false)
    }
  }

  // Hjälpfunktion för att hämta gästnamn
  const getGuestDisplayName = (session) => {
    if (session.metadata?.guest_name) {
      return session.metadata.guest_name
    }
    if (session.visitor_id && !session.visitor_id.startsWith('visitor_')) {
      return session.visitor_id
    }
    return 'Anonym besökare'
  }

  // Hjälpfunktion för att hämta gästkontakt
  const getGuestContact = (session) => {
    return session.metadata?.guest_email || session.metadata?.guest_phone || null
  }

  // Hämta customer name från customers array
  const getCustomerName = (custId) => {
    const customer = customers?.find(c => c.id === custId)
    return customer?.name || null
  }

  // Filter sessions
  const filteredSessions = sessions.filter(session => {
    if (filterCustomer && session.customer_id !== filterCustomer) return false
    if (showOnlyUnread && session.is_read) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const guestName = getGuestDisplayName(session).toLowerCase()
      const guestEmail = session.metadata?.guest_email?.toLowerCase() || ''
      const guestPhone = session.metadata?.guest_phone || ''
      const custName = getCustomerName(session.customer_id)?.toLowerCase() || ''
      
      if (!guestName.includes(query) && 
          !guestEmail.includes(query) && 
          !guestPhone.includes(query) &&
          !custName.includes(query)) {
        return false
      }
    }
    return true
  })

  // Stats
  const needsResponseCount = sessions.filter(s => s.needs_human).length
  const activeCount = sessions.filter(s => s.status === 'active').length
  const unreadCount = sessions.filter(s => !s.is_read).length

  // ============================================
  // SESSION ACTIONS
  // ============================================

  const handleMarkAsRead = async (sessionId, e) => {
    e?.stopPropagation()
    setActionLoading(sessionId)
    try {
      const response = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'markAsRead' })
      })
      if (response.ok) {
        setSessions(prev => prev.map(s => 
          s.id === sessionId ? { ...s, is_read: true } : s
        ))
      }
    } catch (err) {
      console.error('Failed to mark as read:', err)
    } finally {
      setActionLoading(null)
      setShowActionMenu(null)
    }
  }

  const handleMarkAsUnread = async (sessionId, e) => {
    e?.stopPropagation()
    setActionLoading(sessionId)
    try {
      const response = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'markAsUnread' })
      })
      if (response.ok) {
        setSessions(prev => prev.map(s => 
          s.id === sessionId ? { ...s, is_read: false } : s
        ))
      }
    } catch (err) {
      console.error('Failed to mark as unread:', err)
    } finally {
      setActionLoading(null)
      setShowActionMenu(null)
    }
  }

  const handleMarkAllAsRead = async () => {
    const unreadIds = filteredSessions.filter(s => !s.is_read).map(s => s.id)
    if (unreadIds.length === 0) return
    
    setActionLoading('all')
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAllAsRead', customerId: filterCustomer || undefined })
      })
      if (response.ok) {
        setSessions(prev => prev.map(s => 
          unreadIds.includes(s.id) ? { ...s, is_read: true } : s
        ))
      }
    } catch (err) {
      console.error('Failed to mark all as read:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteSession = async (sessionId, e) => {
    e?.stopPropagation()
    if (!confirm('Är du säker på att du vill radera denna chatt?')) return
    
    setActionLoading(sessionId)
    try {
      const response = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'delete' })
      })
      if (response.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId))
        if (selectedSession?.id === sessionId) {
          setSelectedSession(null)
          setMessages([])
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    } finally {
      setActionLoading(null)
      setShowActionMenu(null)
    }
  }

  const handleEscalate = async (sessionId, assignee) => {
    setActionLoading(sessionId)
    try {
      const response = await fetch('/api/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionId, 
          action: 'assign',
          data: {
            toUserId: assignee.type === 'user' ? assignee.id : null,
            toTeamId: assignee.type === 'team' ? assignee.id : null
          }
        })
      })
      if (response.ok) {
        setSessions(prev => prev.map(s => 
          s.id === sessionId ? { 
            ...s, 
            assigned_user_id: assignee.type === 'user' ? assignee.id : null,
            assigned_team_id: assignee.type === 'team' ? assignee.id : null,
            assigned_name: assignee.name || assignee.email
          } : s
        ))
        // Update selected session if it's the one being assigned
        if (selectedSession?.id === sessionId) {
          setSelectedSession(prev => ({
            ...prev,
            assigned_user_id: assignee.type === 'user' ? assignee.id : null,
            assigned_team_id: assignee.type === 'team' ? assignee.id : null,
            assigned_name: assignee.name || assignee.email
          }))
        }
      }
    } catch (err) {
      console.error('Failed to escalate:', err)
    } finally {
      setActionLoading(null)
      setShowEscalateModal(null)
    }
  }

  // ============================================
  // EXISTING FUNCTIONS
  // ============================================

  const loadMessages = async (sessionId) => {
    setLoadingMessages(true)
    try {
      const response = await fetch(`/api/messages?session_id=${sessionId}`)
      const data = await response.json()
      setMessages(data.messages || [])
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      setLoadingMessages(false)
    }
  }

  const handleSelectSession = (session) => {
    setSelectedSession(session)
    loadMessages(session.id)
    // Auto-markera som läst
    if (!session.is_read) {
      handleMarkAsRead(session.id)
    }
  }

  const handleOpenFullChat = (sessionId) => {
    router.push(`/chat/${sessionId}`)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just nu'
    if (diffMins < 60) return `${diffMins} min sedan`
    if (diffHours < 24) return `${diffHours}h sedan`
    if (diffDays < 7) return `${diffDays}d sedan`
    
    return date.toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })
  }

  const formatFullDate = (dateString) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('sv-SE', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  const getStatusBadge = (session) => {
    if (session.needs_human) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-sm">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
          Behöver svar
        </span>
      )
    }
    if (session.status === 'active') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
          Aktiv
        </span>
      )
    }
    return (
      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
        Avslutad
      </span>
    )
  }

  const getAssignedBadge = (session) => {
    if (session.assigned_user_id || session.assigned_team_id) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
          → {session.assigned_name || 'Tilldelad'}
        </span>
      )
    }
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-200/60 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            {/* Logo & Role */}
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-200">
                  <span className="text-white font-bold text-sm sm:text-lg">E</span>
                </div>
                <div className="hidden sm:block">
                  <h1 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                    EryAI
                  </h1>
                  <p className="text-xs text-slate-500">Dashboard</p>
                </div>
              </div>
              
              {isSuperadmin ? (
                <span className="hidden sm:inline-flex px-3 py-1.5 bg-gradient-to-r from-violet-100 to-purple-100 text-violet-700 text-xs font-semibold rounded-full border border-violet-200">
                  ⚡ Superadmin
                </span>
              ) : customerName ? (
                <span className="hidden sm:inline-flex px-3 py-1.5 bg-slate-100 text-slate-600 text-sm font-medium rounded-full">
                  {customerName}
                </span>
              ) : null}
            </div>

            {/* Navigation Tabs - Desktop */}
            <div className="hidden md:flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setActiveView('chats')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeView === 'chats'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                💬 Chattar
                {unreadCount > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded-full">
                    {unreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveView('settings')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeView === 'settings'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                🔔 Notiser
              </button>
              {canAccessAdmin && (
                <button
                  onClick={() => setActiveView('admin')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeView === 'admin'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                >
                  ⚙️ Admin
                </button>
              )}
            </div>

            {/* Stats - Desktop */}
            <div className="hidden lg:flex items-center gap-4">
              {needsResponseCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-xl border border-red-100">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                  <span className="text-sm font-semibold text-red-700">{needsResponseCount}</span>
                  <span className="text-sm text-red-600">väntar</span>
                </div>
              )}
            </div>
            
            {/* User menu */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-9 sm:h-9 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center">
                  <span className="text-slate-600 font-medium text-xs sm:text-sm">
                    {user.email?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-slate-700">{user.email}</p>
                  <p className="text-xs text-slate-400 capitalize">{userRole}</p>
                </div>
              </div>
              
              <button
                onClick={handleLogout}
                className="p-2 sm:p-2.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-xl transition-all"
                title="Logga ut"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation */}
      <div className="md:hidden sticky top-[57px] z-40 bg-white border-b border-slate-200 px-4 py-2">
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setActiveView('chats')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeView === 'chats' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
            }`}
          >
            💬 {unreadCount > 0 && <span className="text-blue-600">({unreadCount})</span>}
          </button>
          <button
            onClick={() => setActiveView('settings')}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeView === 'settings' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
            }`}
          >
            🔔
          </button>
          {canAccessAdmin && (
            <button
              onClick={() => setActiveView('admin')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeView === 'admin' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600'
              }`}
            >
              ⚙️
            </button>
          )}
        </div>
      </div>

      {/* Escalate Modal */}
      {showEscalateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Tilldela konversation</h3>
                <p className="text-sm text-slate-500">Välj en person eller ett team</p>
              </div>
              <button
                onClick={() => setShowEscalateModal(null)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-1">
              {loadingTeamMembers ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-8 h-8 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin"></div>
                </div>
              ) : teamMembers.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500">Inga teammedlemmar tillgängliga</p>
                  <p className="text-sm text-slate-400 mt-1">Lägg till användare i Admin-fliken</p>
                </div>
              ) : (
                <>
                  {/* Teams first */}
                  {teamMembers.filter(m => m.type === 'team').length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 px-2">Team</p>
                      {teamMembers.filter(m => m.type === 'team').map(member => (
                        <button
                          key={member.id}
                          onClick={() => handleEscalate(showEscalateModal, member)}
                          disabled={actionLoading === showEscalateModal}
                          className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-violet-50 transition-colors text-left disabled:opacity-50"
                        >
                          <div className="w-10 h-10 bg-gradient-to-br from-violet-400 to-indigo-400 rounded-xl flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-800">{member.name}</p>
                            <p className="text-xs text-slate-500">{member.member_count || 0} medlemmar</p>
                          </div>
                          <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {/* Users */}
                  {teamMembers.filter(m => m.type === 'user').length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 px-2">Användare</p>
                      {teamMembers.filter(m => m.type === 'user').map(member => (
                        <button
                          key={member.id}
                          onClick={() => handleEscalate(showEscalateModal, member)}
                          disabled={actionLoading === showEscalateModal}
                          className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors text-left disabled:opacity-50"
                        >
                          <div className="w-10 h-10 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center">
                            <span className="text-slate-600 font-medium text-sm">
                              {member.name?.charAt(0).toUpperCase() || '?'}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-slate-800 truncate">{member.email}</p>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500 capitalize">{member.role}</span>
                              {member.team_name && (
                                <span className="text-xs text-violet-600">• {member.team_name}</span>
                              )}
                            </div>
                          </div>
                          <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1600px] mx-auto p-4 sm:p-6">
        {/* Settings View */}
        {activeView === 'settings' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-6">Push-notifikationer</h2>
              <PushNotificationSettings userId={user.id} customerId={customerId} />
            </div>
          </div>
        )}

        {/* Admin View */}
        {activeView === 'admin' && canAccessAdmin && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 p-6">
              <AdminSettings 
                customerId={customerId}
                customerName={customerName}
                currentUserRole={userRole}
                plan={customerPlan}
              />
            </div>
          </div>
        )}

        {/* Chats View */}
        {activeView === 'chats' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
            {/* Sessions list */}
            <div className="lg:col-span-4 xl:col-span-3">
              <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 overflow-hidden">
                {/* Filters */}
                <div className="p-4 border-b border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-slate-800">Konversationer</h2>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{filteredSessions.length} st</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllAsRead}
                          disabled={actionLoading === 'all'}
                          className="text-xs text-violet-600 hover:text-violet-700 font-medium disabled:opacity-50"
                        >
                          {actionLoading === 'all' ? '...' : '✓ Läs alla'}
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Search */}
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Sök..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-0 rounded-xl text-sm placeholder-slate-400 focus:ring-2 focus:ring-violet-500 focus:bg-white transition-all"
                    />
                  </div>

                  {/* Filter row */}
                  <div className="flex items-center gap-2">
                    {/* Unread filter */}
                    <button
                      onClick={() => setShowOnlyUnread(!showOnlyUnread)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                        showOnlyUnread
                          ? 'bg-blue-100 text-blue-700 border border-blue-200'
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${showOnlyUnread ? 'bg-blue-500' : 'bg-slate-400'}`}></span>
                      Olästa
                      {unreadCount > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                          showOnlyUnread ? 'bg-blue-200 text-blue-800' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {unreadCount}
                        </span>
                      )}
                    </button>

                    {/* Customer filter */}
                    {showCustomerFilter && (
                      <select
                        value={filterCustomer}
                        onChange={(e) => setFilterCustomer(e.target.value)}
                        className="flex-1 px-3 py-2 bg-slate-50 border-0 rounded-xl text-sm text-slate-700 focus:ring-2 focus:ring-violet-500"
                      >
                        <option value="">Alla</option>
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Sessions */}
                <div className="max-h-[calc(100vh-320px)] sm:max-h-[calc(100vh-380px)] overflow-y-auto">
                  {filteredSessions.length === 0 ? (
                    <div className="p-8 text-center">
                      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <p className="text-slate-500 font-medium">
                        {showOnlyUnread ? 'Inga olästa chattar' : 'Inga konversationer'}
                      </p>
                      <p className="text-sm text-slate-400 mt-1">
                        {showOnlyUnread ? 'Alla chattar är lästa!' : 'Chattar visas här när de kommer in'}
                      </p>
                    </div>
                  ) : (
                    filteredSessions.map(session => {
                      const guestName = getGuestDisplayName(session)
                      const guestContact = getGuestContact(session)
                      const custName = getCustomerName(session.customer_id)
                      const isSelected = selectedSession?.id === session.id
                      const isUnread = !session.is_read
                      
                      return (
                        <div
                          key={session.id}
                          className={`relative group ${
                            isSelected 
                              ? 'bg-gradient-to-r from-violet-50 to-indigo-50 border-l-4 border-l-violet-500' 
                              : isUnread
                              ? 'bg-blue-50/50 hover:bg-blue-50'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <button
                            onClick={() => handleSelectSession(session)}
                            className="w-full p-4 text-left border-b border-slate-100 transition-all"
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {isUnread && (
                                  <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></span>
                                )}
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                  session.needs_human 
                                    ? 'bg-gradient-to-br from-red-400 to-orange-400' 
                                    : 'bg-gradient-to-br from-slate-200 to-slate-300'
                                }`}>
                                  <span className={`text-xs font-semibold ${
                                    session.needs_human ? 'text-white' : 'text-slate-600'
                                  }`}>
                                    {guestName.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <span className={`font-medium truncate ${isUnread ? 'text-slate-900' : 'text-slate-800'}`}>
                                  {guestName}
                                </span>
                              </div>
                              {getStatusBadge(session)}
                            </div>
                            
                            {guestContact && (
                              <p className="text-xs text-slate-500 truncate mb-1 ml-10">
                                {guestContact}
                              </p>
                            )}
                            
                            {showCustomerFilter && custName && (
                              <p className="text-xs font-medium text-violet-600 mb-1 ml-10">
                                {custName}
                              </p>
                            )}

                            {/* Show assigned badge */}
                            {(session.assigned_user_id || session.assigned_team_id) && (
                              <div className="ml-10 mb-1">
                                {getAssignedBadge(session)}
                              </div>
                            )}
                            
                            <div className="flex items-center justify-between text-xs text-slate-400 ml-10">
                              <span>{formatDate(session.updated_at)}</span>
                              <span>{session.message_count || 0} meddelanden</span>
                            </div>
                          </button>
                          
                          {/* Action menu trigger */}
                          <div 
                            className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            ref={showActionMenu === session.id ? actionMenuRef : null}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setShowActionMenu(showActionMenu === session.id ? null : session.id)
                              }}
                              className="p-1.5 hover:bg-white/80 rounded-lg shadow-sm bg-white/60 backdrop-blur-sm"
                            >
                              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                              </svg>
                            </button>
                            
                            {/* Action dropdown */}
                            {showActionMenu === session.id && (
                              <div className="absolute right-0 top-8 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-20">
                                {session.is_read ? (
                                  <button
                                    onClick={(e) => handleMarkAsUnread(session.id, e)}
                                    disabled={actionLoading === session.id}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                    Markera som oläst
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => handleMarkAsRead(session.id, e)}
                                    disabled={actionLoading === session.id}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    Markera som läst
                                  </button>
                                )}

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setShowActionMenu(null)
                                    setShowEscalateModal(session.id)
                                  }}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                >
                                  <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                  Tilldela / Eskalera
                                </button>
                                
                                <div className="my-1 border-t border-slate-100"></div>
                                
                                <button
                                  onClick={(e) => handleDeleteSession(session.id, e)}
                                  disabled={actionLoading === session.id}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                  Radera chatt
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Chat view */}
            <div className="lg:col-span-8 xl:col-span-9">
              <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200/60 h-[calc(100vh-200px)] sm:h-[calc(100vh-180px)] flex flex-col overflow-hidden">
                {selectedSession ? (
                  <>
                    {/* Chat header */}
                    <div className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                          <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            selectedSession.needs_human 
                              ? 'bg-gradient-to-br from-red-400 to-orange-400' 
                              : 'bg-gradient-to-br from-violet-400 to-indigo-400'
                          }`}>
                            <span className="text-white font-bold text-base sm:text-lg">
                              {getGuestDisplayName(selectedSession).charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-slate-800 text-base sm:text-lg truncate">
                              {getGuestDisplayName(selectedSession)}
                            </h3>
                            <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm flex-wrap">
                              {getGuestContact(selectedSession) && (
                                <span className="text-slate-600 truncate">
                                  {getGuestContact(selectedSession)}
                                </span>
                              )}
                              <span className="text-slate-400 hidden sm:inline">•</span>
                              <span className="text-slate-400 hidden sm:inline">
                                {formatFullDate(selectedSession.session_start)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                          {getAssignedBadge(selectedSession)}
                          <button
                            onClick={() => setShowEscalateModal(selectedSession.id)}
                            className="p-2 text-slate-500 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-all"
                            title="Tilldela"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleOpenFullChat(selectedSession.id)}
                            className="px-3 sm:px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium rounded-xl hover:from-violet-700 hover:to-indigo-700 transition-all shadow-lg shadow-violet-200"
                          >
                            <span className="hidden sm:inline">Öppna fullvy →</span>
                            <span className="sm:hidden">Svara</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-gradient-to-b from-slate-50/50 to-white">
                      {loadingMessages ? (
                        <div className="flex items-center justify-center h-full">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-10 h-10 border-3 border-violet-200 border-t-violet-600 rounded-full animate-spin"></div>
                            <span className="text-sm text-slate-500">Laddar meddelanden...</span>
                          </div>
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-slate-500">
                          <div className="text-center">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                            </div>
                            <p className="font-medium">Inga meddelanden ännu</p>
                          </div>
                        </div>
                      ) : (
                        messages.map((msg, idx) => {
                          const isUser = msg.role === 'user'
                          const isHuman = msg.sender_type === 'human'
                          
                          return (
                            <div
                              key={idx}
                              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 sm:px-5 py-3 shadow-sm ${
                                  isUser
                                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white'
                                    : isHuman
                                    ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-200 text-slate-800'
                                    : 'bg-white border border-slate-200 text-slate-800'
                                }`}
                              >
                                {!isUser && (
                                  <p className={`text-xs font-semibold mb-1.5 ${
                                    isHuman ? 'text-emerald-600' : 'text-violet-600'
                                  }`}>
                                    {isHuman ? '👤 Personal' : '🤖 AI-assistent'}
                                  </p>
                                )}
                                <p className="whitespace-pre-wrap leading-relaxed text-sm sm:text-base">{msg.content}</p>
                                <p className={`text-xs mt-2 ${
                                  isUser ? 'text-violet-200' : 'text-slate-400'
                                }`}>
                                  {formatFullDate(msg.created_at)}
                                </p>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>

                    {selectedSession.needs_human && (
                      <div className="p-3 sm:p-4 border-t border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                              <span className="text-xl">⚡</span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-amber-800 text-sm sm:text-base">Kunden väntar på svar</p>
                              <p className="text-xs sm:text-sm text-amber-600 hidden sm:block">Klicka för att svara direkt</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleOpenFullChat(selectedSession.id)}
                            className="px-4 sm:px-5 py-2 sm:py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium rounded-xl hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg shadow-amber-200 flex-shrink-0"
                          >
                            Svara nu →
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center px-4">
                      <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-slate-100 to-slate-200 rounded-3xl flex items-center justify-center mx-auto mb-6">
                        <svg className="w-10 h-10 sm:w-12 sm:h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <h3 className="text-lg sm:text-xl font-semibold text-slate-700 mb-2">Välj en konversation</h3>
                      <p className="text-slate-500 text-sm sm:text-base">Klicka på en chatt i listan för att se meddelanden</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
