import React, { useState } from "react";
import { useLocation, Link } from "wouter";
import { Eye, EyeOff, Lock, User, ArrowRight, Sun, Moon, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { login } from "@/api/client";

export default function LoginPage() {
    const [, setLocation] = useLocation();
    const { theme, toggle } = useTheme();
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        try {
            await login(username, password);
            setLocation("/");
        } catch (err: any) {
            setError(err.message || "Invalid credentials");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" asChild>
                    <a href="https://github.com/rehanweb3/DBCraft-2.0" target="_blank" rel="noreferrer"><Github className="w-4 h-4" /></a>
                </Button>
                <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={toggle}>
                    {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
            </div>
            <div className="w-full max-w-[400px] z-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col items-center mb-6 text-center">
                    <div className="h-16 flex items-center justify-center mb-2">
                        <img
                            src={theme === "dark" ? "/dark.png" : "/white.png"}
                            alt="Docklet"
                            className="max-h-full w-auto object-contain"
                        />
                    </div>
                </div>
                <Card className="bg-background border-border shadow-none rounded-2xl overflow-hidden">
                    <form onSubmit={handleSubmit}>
                        <CardHeader className="space-y-1 pt-8">
                            <CardTitle className="text-lg font-medium tracking-tight">Sign in</CardTitle>
                            <CardDescription className="text-xs">Enter your credentials to access your dashboard</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {error && (
                                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</div>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="username" className="text-xs font-medium text-muted-foreground">Username</Label>
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground/50 group-focus-within:text-primary transition-colors">
                                        <User className="w-3.5 h-3.5" />
                                    </div>
                                    <Input id="username" type="text" placeholder="admin" required value={username} onChange={e => setUsername(e.target.value)} className="pl-9 h-10 border-border bg-muted/5 focus:bg-background transition-all shadow-none" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</Label>
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground/50 group-focus-within:text-primary transition-colors">
                                        <Lock className="w-3.5 h-3.5" />
                                    </div>
                                    <Input id="password" type={showPassword ? "text" : "password"} placeholder="••••••••" required value={password} onChange={e => setPassword(e.target.value)} className="pl-9 pr-10 h-10 border-border bg-muted/5 focus:bg-background transition-all shadow-none" />
                                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter className="pb-8 pt-2 flex flex-col gap-3">
                            <Button type="submit" disabled={isLoading} className={cn("w-full h-10 gap-2 rounded-xl text-xs font-medium transition-all border border-black/10 dark:border-white/10 shadow-none", "bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47]")}>
                                {isLoading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <>Sign In <ArrowRight className="w-3.5 h-3.5" /></>}
                            </Button>
                            <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center w-full">
                                Forgot password?
                            </Link>
                        </CardFooter>
                    </form>
                </Card>
            </div>
            <div className="absolute bottom-6 w-full text-center">
                <p className="text-[10px] text-muted-foreground/40 font-mono tracking-widest uppercase">© 2026 Docklet · All Rights Reserved</p>
            </div>
        </div>
    );
}
