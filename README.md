# TeGe Office

Pembaca dokumen kantor dan PDF untuk Android: **DOCX, XLSX, PPTX, dan PDF**.
Dibuat oleh **Guru SMA Negeri 3 Maliku** untuk guru dan pelajar.

- Dokumen dibaca langsung di perangkat. Tidak ada akun, iklan, atau pelacak.
- Fitur: pembaca Word/Excel/PowerPoint/PDF, Presentasi ke Layar Lain di jaringan lokal (kode 4 angka), Terakhir dibuka, dan Disematkan.
- Kebijakan privasi: https://tgoffice.totogutomo.com/privacy.html
- Syarat penggunaan: https://tgoffice.totogutomo.com/terms.html

## Struktur

| Folder | Isi |
|---|---|
| `TG-Office-Integrated/` | Aplikasi utama (Gradle). Antarmuka web ada di `app/src/main/assets/web/`. |
| `TG-Office-Integrated/pdfengine/` | Modul pembaca PDF native. |
| `TG-Office-Integrated/scripts/` | Skrip penyiapan aset (`prepare-web-assets.sh`, `build-bundle.py`). |
| `app/` | Kode Java dan sumber daya pembaca PDF yang dipakai bersama oleh `pdfengine`. |

## Membangun

1. Siapkan aset web dan mesin offline (dari akar repo):
   ```
   bash TG-Office-Integrated/scripts/prepare-web-assets.sh
   ```
2. Bangun APK debug:
   ```
   gradle -p TG-Office-Integrated :app:assembleDebug
   ```
   Butuh JDK 17, Android SDK platform 36 (dengan extension 19), dan Gradle 8.11.1.

Berkas kunci penandatanganan rilis tidak disertakan di repo.

## Lisensi

GNU General Public License versi 3 (GPL-3.0). Lihat berkas [LICENSE](LICENSE).
Pustaka pihak ketiga (AndroidX, Material, PDF.js, pptx-renderer, ECharts, JSZip, font Plus Jakarta Sans, Liberation, Carlito) memakai lisensinya masing-masing. Daftarnya ada di halaman Lisensi dalam aplikasi.

## Kontak

Masukan dan laporan kesalahan: totogutomo92@gmail.com
Situs: https://totogutomo.com

TeGe Office © 2026 | totogutomo.com
