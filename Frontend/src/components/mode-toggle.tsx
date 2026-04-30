import { Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"

declare global {
    interface Document {
        startViewTransition?: (callback: () => void) => ViewTransition
    }
    interface ViewTransition {
        ready: Promise<void>
        finished: Promise<void>
        updateCallbackDone: Promise<void>
    }
}

export function ModeToggle() {
    const { theme, setTheme } = useTheme()

    const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
        const btn = e.currentTarget
        const rect = btn.getBoundingClientRect()
        const x = Math.round(rect.left + rect.width / 2)
        const y = Math.round(rect.top + rect.height / 2)
        const next = theme === "dark" ? "light" : "dark"

        if (!document.startViewTransition) {
            setTheme(next)
            return
        }

        document.documentElement.style.setProperty("--theme-x", `${x}px`)
        document.documentElement.style.setProperty("--theme-y", `${y}px`)

        document.startViewTransition(() => {
            setTheme(next)
        })
    }

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            className="h-9 w-9 rounded-lg border border-border"
        >
            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
        </Button>
    )
}
