'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Radio, ArrowRight, Home } from 'lucide-react'

export default function JoinPage() {
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!roomCode.trim()) {
      setError('Please enter a room code')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch(`/api/streams/${roomCode.toUpperCase()}`)
      const data = await response.json()

      if (!response.ok) {
        setError('Stream not found. Please check the room code.')
        return
      }

      if (data.stream.status === 'ended') {
        setError('This stream has ended.')
        return
      }

      router.push(`/watch/${roomCode.toUpperCase()}`)
    } catch {
      setError('Failed to find stream. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="relative">
            <Radio className="h-10 w-10 text-primary" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-live" />
            </span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Isunday Stream Live</h1>
        </div>

        <Card className="border-border shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-card-foreground">Join a Live Stream</CardTitle>
            <CardDescription>Enter the room code to watch</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Enter room code (e.g., ABC123XY)"
                  value={roomCode}
                  onChange={(e) => {
                    setRoomCode(e.target.value.toUpperCase())
                    setError('')
                  }}
                  className="text-center text-lg tracking-widest uppercase font-mono"
                  maxLength={10}
                />
                {error && (
                  <p className="text-sm text-destructive text-center">{error}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isLoading || !roomCode.trim()}
              >
                {isLoading ? (
                  'Finding stream...'
                ) : (
                  <>
                    Join Stream
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center mb-4">
                Don&apos;t have a room code?
              </p>
              <div className="flex flex-col gap-2">
                <Link href="/">
                  <Button variant="outline" className="w-full">
                    <Home className="mr-2 h-4 w-4" />
                    Back to Home
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Stream anywhere. Watch everywhere.
        </p>
      </div>
    </div>
  )
}
