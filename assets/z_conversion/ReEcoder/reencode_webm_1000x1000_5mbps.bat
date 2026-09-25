@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===============================
echo   WebM Resizer (1000x1000, 5 Mbps)
echo ===============================
echo.

where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo Error: ffmpeg is not installed or not on PATH.
    echo Download it from: https://ffmpeg.org/download.html
    echo.
    pause
    exit /b 1
)

set found=0
set success=0
set failed=0

for %%F in (*.webm) do (
    set "fname=%%~nF"
    if "!fname:~-16!"=="_1000x1000_5mbps" (
        rem skip files we already produced
    ) else (
        set /a found+=1
        set "output=%%~nF_1000x1000_5mbps.webm"
        echo Processing: %%F -^> !output!

        ffmpeg -c:v libvpx-vp9 -i "%%F" ^
            -vf "format=yuva420p,scale=1000:1000:force_original_aspect_ratio=decrease,pad=1000:1000:(ow-iw)/2:(oh-ih)/2:color=0x00000000" ^
            -c:v libvpx-vp9 ^
            -b:v 5M ^
            -minrate 5M ^
            -maxrate 5M ^
            -bufsize 10M ^
            -auto-alt-ref 0 ^
            -c:a libopus ^
            -y "!output!" ^
            -loglevel error -stats

        if errorlevel 1 (
            echo   Failed!
            set /a failed+=1
        ) else (
            echo   Done!
            set /a success+=1
        )
        echo.
    )
)

if !found!==0 (
    echo No .webm files found in this folder.
    echo.
    pause
    exit /b 0
)

echo ===============================
echo Resize + re-encode complete!
echo   Succeeded: !success!
echo   Failed:    !failed!
echo ===============================
echo.
pause
