@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===============================
echo   WebM Re-encoder (1 Mbps)
echo ===============================
echo.

where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo Error: ffmpeg is not installed or not on PATH.
    echo Download it from: https://ffmpeg.org/download.html
    echo and make sure ffmpeg.exe is in a folder listed in your PATH.
    echo.
    pause
    exit /b 1
)

set found=0
set success=0
set failed=0

for %%F in (*.webm) do (
    echo %%~nF | findstr /e "_1mbps" >nul
    if errorlevel 1 (
        set /a found+=1
    )
)

if %found%==0 (
    echo No .webm files found in this folder.
    echo.
    pause
    exit /b 0
)

echo Found %found% .webm file^(s^). Starting re-encode...
echo.

for %%F in (*.webm) do (
    echo %%~nF | findstr /e "_1mbps" >nul
    if errorlevel 1 (
        set "output=%%~nF_1mbps.webm"
        echo Re-encoding: %%F -^> !output!

        ffmpeg -c:v libvpx-vp9 -i "%%F" ^
            -vf "format=yuva420p" ^
            -c:v libvpx-vp9 ^
            -b:v 1M ^
            -minrate 1M ^
            -maxrate 1M ^
            -bufsize 2M ^
            -auto-alt-ref 0 ^
            -c:a libopus ^
            -y "!output!" ^
            -loglevel error -stats

        if !errorlevel!==0 (
            echo   Done!
            set /a success+=1
        ) else (
            echo   Failed!
            set /a failed+=1
        )
        echo.
    )
)

echo ===============================
echo Re-encode complete!
echo   Succeeded: %success%
echo   Failed:    %failed%
echo ===============================
echo.
pause
