@echo off
if "%~1"=="" (
    echo Bitte ziehe eine Videodatei per Drag-and-Drop auf dieses Skript.
    pause
    exit /b
)

set "INPUT=%~1"
set "OUTPUT=%~dpn1_h264.mp4"

ffmpeg -i "%INPUT%" ^
  -c:v libx264 ^
  -crf 23 ^
  -preset medium ^
  -pix_fmt yuv420p ^
  -c:a aac ^
  -b:a 128k ^
  "%OUTPUT%"

echo.
echo Fertig! Gespeichert als: "%OUTPUT%"
pause
