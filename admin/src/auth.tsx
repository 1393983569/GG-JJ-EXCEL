import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { pb, type Staff } from './pb'

type AuthState = {
  user: Staff | null
  ready: boolean
  hasMenu: (code: string) => boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthState>({
  user: null,
  ready: false,
  hasMenu: () => false,
  login: async () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Staff | null>(
    pb.authStore.isValid ? (pb.authStore.record as unknown as Staff) : null
  )
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const unsub = pb.authStore.onChange((_token, record) => {
      setUser((record as unknown as Staff) || null)
    })
    if (pb.authStore.isValid) {
      pb.collection('staff')
        .authRefresh()
        .catch(() => pb.authStore.clear())
        .finally(() => setReady(true))
    } else {
      setReady(true)
    }
    return () => unsub()
  }, [])

  const hasMenu = (code: string) => {
    if (!user) return false
    return Array.isArray(user.menus) && user.menus.indexOf(code) >= 0
  }

  const login = async (username: string, password: string) => {
    await pb.collection('staff').authWithPassword(username, password)
    setUser(pb.authStore.record as unknown as Staff)
  }

  const logout = () => {
    pb.authStore.clear()
    setUser(null)
  }

  return <Ctx.Provider value={{ user, ready, hasMenu, login, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
