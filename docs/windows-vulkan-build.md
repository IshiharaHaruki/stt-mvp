# Building whisper.cpp with Vulkan on Windows (Intel / AMD / NVIDIA GPU)

The official whisper.cpp Windows releases only ship **CPU (Win32)** and **CUDA
(NVIDIA)** binaries — there is **no official Vulkan build**. Vulkan is the
cross-vendor GPU path that accelerates on **Intel** (Iris Xe / UHD / Arc), **AMD**,
and NVIDIA. You build it once, then ship the resulting `whisper-server.exe` + DLLs
with the app.

> You only need to build on **one** machine. The other machines just need a
> Vulkan-capable GPU driver (Intel/AMD/NVIDIA drivers include it) — **not** the
> Vulkan SDK and **not** a compiler.

## Prerequisites (on the build machine)

1. **Visual Studio 2022 or 2019** (Community is fine) with the
   **"Desktop development with C++"** workload — this provides MSVC + CMake.
   whisper.cpp only needs **C++17**, which both support.
   - Download: <https://visualstudio.microsoft.com/downloads/>
   - ⚠️ The Vulkan backend requires **CMake ≥ 3.19**. VS's bundled CMake is usually
     fine; if you hit a CMake-version error, install the latest from <https://cmake.org/download/>.
   - On VS 2019, name the generator explicitly:
     `cmake -B build -G "Visual Studio 16 2019" -A x64 -DGGML_VULKAN=1`
     (VS 2022 uses `"Visual Studio 17 2022"`, or just omit `-G` when running from
     the matching "x64 Native Tools Command Prompt".)
2. **Vulkan SDK** (LunarG) — provides headers, libs, and `glslc` (the shader
   compiler the Vulkan backend needs **at build time**). The installer sets the
   `VULKAN_SDK` environment variable.
   - Download: <https://vulkan.lunarg.com/sdk/home> → Windows
3. **Git** — <https://git-scm.com/download/win>

After installing, **open a new terminal** so `VULKAN_SDK` is set. Quick check:
```powershell
echo $env:VULKAN_SDK      # should print the SDK path
```

## Build

Use the **"x64 Native Tools Command Prompt for VS 2022"** (Start menu → it sets up
the MSVC compiler), or a regular PowerShell if CMake can already find MSVC:

```powershell
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build -DGGML_VULKAN=1
cmake --build build -j --config Release
```

This produces, in `build\bin\Release\`:

- `whisper-server.exe`, `whisper-cli.exe`
- `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`, **`ggml-vulkan.dll`**, `whisper.dll`

This is a **64-bit** build (no 32-bit memory limit, unlike the official Win32 CPU zip).

## Verify it uses the GPU

```powershell
cd build\bin\Release
.\whisper-cli.exe -m C:\path\to\models\ggml-small-q5_1.bin -f C:\path\to\jfk.wav
```

In the log you should see a Vulkan device line, e.g.:
```
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = Intel(R) Iris(R) Xe Graphics (...)
```
If it lists your Intel/AMD GPU, GPU acceleration is working.

## Wire it into this app

```powershell
$env:WHISPER_SERVER_BIN = "C:\...\whisper.cpp\build\bin\Release\whisper-server.exe"
$env:WHISPER_MODEL      = "C:\...\models\ggml-small-q5_1.bin"
npm start
```

The app spawns the server with its own folder as the working directory, so the
DLLs sitting next to `whisper-server.exe` are resolved automatically.

## Distributing to other machines

Copy the **entire `build\bin\Release\` folder** (the `.exe` files **and all the
`.dll` files**) plus the model `.bin`. On each target machine:

- Required: an up-to-date **GPU driver** (Intel graphics driver, etc.) so the
  Vulkan runtime is present. If `whisper-cli` reports "no Vulkan devices", update
  the driver.
- Not required: Visual Studio, the Vulkan SDK, or any compiler.

For an installer, bundle that folder + model as `electron-builder` `extraResources`
and point `WHISPER_SERVER_BIN` / `WHISPER_MODEL` at the unpacked paths
(`process.resourcesPath`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `glslc` not found / shader-gen fails during build | Vulkan SDK not installed or `VULKAN_SDK` unset — install it, open a fresh terminal |
| CMake: "no CMAKE_CXX_COMPILER found" | Build from the **x64 Native Tools Command Prompt for VS 2022**, or install the VS C++ workload |
| Runtime: "no Vulkan devices found" | Update the GPU driver; verify with `vulkaninfo` (ships with the SDK) |
| Runtime: missing DLL error | Ship **all** DLLs from `build\bin\Release\` next to `whisper-server.exe` |

## Alternative if you don't want to build

On **Intel without a GPU build**, the official **CPU** zip
(`whisper-blas-bin-Win32.zip`) works with the `small` model and needs no compiling
— just slower. Build Vulkan only if CPU latency isn't good enough.
