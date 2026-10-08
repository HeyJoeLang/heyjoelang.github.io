# Minimal static file server for local preview (no python/node on this machine).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .claude/serve.ps1 -Port 8792
param(
    [int]$Port = 8792,
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".mjs"  = "text/javascript; charset=utf-8"
    ".json" = "application/json"
    ".glb"  = "model/gltf-binary"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".png"  = "image/png"
    ".webp" = "image/webp"
    ".gif"  = "image/gif"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".mp4"  = "video/mp4"
    ".pdf"  = "application/pdf"
    ".woff" = "font/woff"
    ".woff2" = "font/woff2"
    ".md"   = "text/plain; charset=utf-8"
}

$rootFull = [IO.Path]::GetFullPath($Root)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $rootFull at http://localhost:$Port/"

try
{
    while ($listener.IsListening)
    {
        $ctx = $listener.GetContext()
        $res = $ctx.Response

        try
        {
            $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
            if ($rel -eq "") { $rel = "index.html" }

            $path = [IO.Path]::GetFullPath((Join-Path $rootFull $rel))
            if ((Test-Path $path -PathType Container)) { $path = Join-Path $path "index.html" }

            # Refuse anything that resolves outside the site root.
            if (-not $path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $path -PathType Leaf))
            {
                $res.StatusCode = 404
                $body = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
                $res.ContentType = "text/plain"
                $res.OutputStream.Write($body, 0, $body.Length)
                Write-Host "404 /$rel"
            }
            else
            {
                $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
                $type = $mime[$ext]
                if (-not $type) { $type = "application/octet-stream" }

                $bytes = [IO.File]::ReadAllBytes($path)
                $res.ContentType = $type
                $res.ContentLength64 = $bytes.Length
                $res.Headers.Add("Cache-Control", "no-store")
                if ($ctx.Request.HttpMethod -ne "HEAD") { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
                Write-Host "200 /$rel"
            }
        }
        catch
        {
            Write-Host "error: $_"
        }
        finally
        {
            $res.Close()
        }
    }
}
finally
{
    $listener.Stop()
}
