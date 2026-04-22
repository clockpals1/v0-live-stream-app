import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio, VideoOff } from "lucide-react";

interface StreamNotFoundProps {
  roomCode: string;
}

export function StreamNotFound({ roomCode }: StreamNotFoundProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <VideoOff className="w-8 h-8 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">Stream Not Found</CardTitle>
          <CardDescription>
            The stream with code <span className="font-mono font-medium">{roomCode}</span> doesn&apos;t exist or has been removed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button asChild>
            <Link href="/">
              <Radio className="w-4 h-4 mr-2" />
              Go to Homepage
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
