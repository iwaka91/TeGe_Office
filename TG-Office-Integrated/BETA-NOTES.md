# TG Office Beta 0.5.0-beta1

Cabang: `feat/tg-office-beta` · Paket uji: `com.totogutomo.tgoffice.beta` (terpasang berdampingan dengan versi lain).

## Yang berubah (tampilan)
- Beranda baru: logo A+B, tombol Buka File, ikon format netral (DOCX/XLSX/PPTX/PDF) 3D dengan kilau sesekali, Disematkan, Terakhir dibuka, footer.
- Drive, OneDrive, animasi orbit, skrip Netlify, dan kunci API dibuang dari aplikasi.
- Font Plus Jakarta Sans dibundel (`web/fonts`, OFL).
- Penampil: top bar (kembali, nama file, menu), menu seragam per format, panel Cari, dialog Lompat, chip zoom + Pas layar, navigasi pill.
- Cetak: PDF (file asli ke dialog Android), Word (per halaman), PowerPoint (1/4/6 slide per lembar), Excel (muat lebar kertas).
- PowerPoint: Tampilan Satu slide / Gulir (diingat per file).
- Tentang, Kebijakan Privasi, Syarat Penggunaan, dan Lisensi baru (GPL-3.0).

## Perbaikan
- PDF tidak lagi terbuka dua kali dan kini tercatat di Terakhir dibuka.
- File dari aplikasi lain (DOCX/XLSX/PPTX) kini benar-benar terbuka.
- Bagikan memakai lembar berbagi Android; warna bar sistem ikut tema; tombol kembali menutup menu/dialog dulu.

## Mesin offline
CI mengunduh `pdfjs-dist@6.3.289` dan `@aiden0z/pptx-renderer@1.3.0` (Apache-2.0) ke `web/vendor/` saat build,
jadi APK tidak memuat apa pun dari internet. Izin INTERNET masih dipertahankan sampai diuji di perangkat.

## Sumber JavaScript
Edit modul di `web/js/` lalu jalankan `python3 TG-Office-Integrated/scripts/build-bundle.py` untuk membangun `app.bundle.js`.

## 0.5.1-beta2
- Beranda baru: hero gabungan (kluster ubin kaca 3D untuk pemakai baru, kartu "Lanjutkan membaca" saat ada riwayat), wordmark TG Office, ikon format netral berbentuk (tanpa huruf merek).
- Animasi buka file segera setelah disentuh (kartu melebar + spinner), juga saat PDF menunggu pembaca native.
- Tekan lama pada file di riwayat: Ganti nama (file asli bila sumber mengizinkan; selain itu simpan salinan bernama baru dan riwayat beralih ke salinan), Sematkan, Hapus dari riwayat.
- Mode Presentasi PPTX untuk IFP: bilah melayang, pena 5 warna 3 ketebalan, penghapus, laser, sorot, layar hitam, pewaktu, layar tetap menyala.
- Perbaikan: Bagikan PDF (FileProvider ganda digabung), tombol menu rata kanan saat mendatar, Back saat mendatar kembali ke tegak dulu, ganti PDF A ke B (tunggu pembaca lama tertutup + coba ulang otomatis sekali).
- Tentang: "penyematan file", tanpa nama sekolah, tagline miring.

## 0.5.2-beta3
- Beranda: barisan 4 tombol format kembali (ikon bergambar), ubin kecil di hero dihapus.
- Hero: progres PDF dari pembaca native (halaman terakhir + jumlah halaman), XLSX "Sheet x dari N" tanpa cincin. Lanjutkan PDF membuka halaman terakhir.
- Riwayat: ukuran · hari ini/kemarin/tanggal + jam · jumlah halaman/slide/sheet.
- Presentasi: panel samping (kiri, bisa pindah kanan, bisa dilipat), slide menyesuaikan sisa ruang; pena/laser/sorot dengan pilihan warna & ukuran; kontrol media (putar/jeda, mundur/maju 10 dtk, posisi, volume media sistem HP).
- Tautan luar minta konfirmasi; tautan pada bentuk bisa diketuk saat presentasi.
- Flipbook: zoom cubit, geser saat diperbesar, ketuk dua kali untuk zoom/kembali, render ulang tajam.

## 0.5.3-beta4 (perbaikan bug)
- Rename: nama tidak lagi menjadi "msf:…"; alamat file yang masih bisa dibuka tetap dipakai sehingga rename berikutnya berjalan.
- Flipbook zoom: hanya halaman terlihat yang dirender tajam (maks 2,5x) dan ukurannya muat di cache; tidak ada lagi "Memuat halaman" tanpa akhir.
- Flipbook saat zoom: geser mentok di tepi lalu gesek terus = pindah halaman; area ketuk tepi 15%.
- Penyimpanan: salinan riwayat dibatasi total 60 MB (tertua yang tidak disematkan dibuang); salinan sementara PDF dihapus setelah pembaca ditutup.

## 0.6.0-beta1
- Presentasi ke IFP (nirkabel): menu PPTX › Presentasi ke IFP. HP menjalankan server lokal (port 8080–8090), IFP membuka alamat di browser (QR tersedia) lalu memasukkan kode 4 angka. Slide dirender di IFP; pena dua arah tersinkron, laser, sorot, layar hitam, kontrol video (putar/jeda, ±10 detik, volume relatif). Pengendali HP: pratinjau slide, slide berikutnya dan catatan pembicara (opsional lewat menu centang), pewaktu, ganti kode, putuskan.
- Riwayat hanya menyimpan alamat file (URI) bila izin baca permanen; salinan hanya untuk akses sementara (mis. WhatsApp). Salinan lama otomatis dibuang. File yang hilang: "File tidak ditemukan" dengan Pilih lagi / Hapus dari riwayat.
- Sapaan kartu Lanjutkan membaca sesuai jam HP: "Selamat pagi/siang/sore/malam! Lanjut membaca yang tadi?"
- PDF: tombol halaman pertama/terakhir jadi kapsul ⏏ kecil transparan (40%, 90% saat disentuh, hilang setelah 2 detik).
- Tentang dan Kebijakan Privasi diperbarui (jaringan lokal, riwayat berbasis alamat).

## 0.6.1-beta2
- Menu **Presentasi ke Layar Lain** (sebelumnya Presentasi ke IFP): untuk IFP, laptop + proyektor, atau TV dengan browser. Alurnya sama: Wi-Fi yang sama atau hotspot HP, buka alamat di browser, masukkan kode 4 angka.
- Bilah warna/ukuran tidak menutup sendiri. Ada tombol ✕ di kanan. Ketuk alat aktif saat bilah tertutup untuk membukanya lagi; ketuk lagi saat bilah terbuka untuk mematikan alat. Pilihan warna dan ukuran diingat, dan titik warna aktif tampil di ikon alat (HP dan browser penerima).
- Alat **Teks** sederhana (HP dan browser penerima): ketuk slide, ketik, pilih Kecil/Sedang/Besar dan warna. Tersinkron dua arah. Hapus lewat Penghapus atau **Urung**.
- Tombol **Urung** menghapus coretan/teks terakhir milik sendiri di slide aktif.
- Tombol Back saat presentasi: dialog "Anda sedang presentasi ke layar lain" dengan Kembali ke presentasi / Keluar presentasi.
- Tombol Home tidak memutus sambungan: notifikasi tetap (Kembali / Akhiri) menjaga sesi. Menggeser aplikasi dari daftar terbaru mengakhiri sesi.
- **Presentasikan** kini sederhana: HP mendatar, layar penuh, layar menyala. Geser atau ketuk sisi kanan/kiri untuk pindah slide, Back untuk keluar. Hanya Pena, Hapus, Bersihkan.
- Menu Tampilan menjadi toggle langsung: Word "Mengalir | Halaman", PowerPoint "Satu slide | Gulir" (menu tetap terbuka, diingat per file). Thumbnail menjadi saklar.

## 0.6.1-beta3 (kandidat stabil)
- PowerPoint: zoom cubit dimatikan di Satu slide dan Gulir (penyebab HP lag). Saat dicubit muncul arahan "Untuk tampilan lebih luas, gunakan menu Presentasikan."
- PowerPoint: menu Putar layar dihapus (sudah ada Presentasikan). Layar penuh tetap.
- PDF: menu hamburger diseragamkan dengan Word/Excel/PowerPoint. Bagian atas khas PDF (Flipbook, Mode buku, Thumbnail, Tandai halaman), lalu Putar layar, Layar penuh, Tema, **Cetak** (baru, dialog cetak Android dengan PDF asli), Bagikan PDF. Cari teks tetap di bilah atas.
- PDF macet saat memuat: bila percobaan ulang otomatis gagal, atau layar disentuh saat memuat lalu tetap tidak terbuka dalam 20 detik, muncul dialog **Coba lagi** (memulai ulang aplikasi lalu langsung membuka PDF yang sama di halaman terakhir; file berizin sementara memakai salinan lokal), **Pilih file lain**, atau **Tunggu**. Sebelumnya, menyentuh layar saat memuat mematikan pengaman sehingga aplikasi harus dimulai ulang manual.

## 0.6.1-rc1 (Release Candidate)
- Menu hamburger PDF dipersempit, lebarnya sama dengan menu Word/Excel/PPTX (min 300dp / layar−20dp, rata kanan 10dp).
- Bilah atas PDF dibersihkan: hanya Buka file · judul · Cari teks · menu. Tema, Putar layar, Layar penuh, dan Bagikan kini cukup lewat menu.
- Bug PDF lama dimuat tidak muncul lagi pada uji berulang; dialog pemulihan tetap ada sebagai jaring pengaman.

## 0.6.1-rc2
- Akar gagalnya pengawas PDF ditemukan: showStatus/hideStatus menghapus semua tugas terjadwal, termasuk pengawas, sehingga setelah "dokumen berhasil dimuat" pengawas mati sebelum halaman tergambar. Kini pengawas berjalan di utas terpisah dengan Handler sendiri.
- Pengawas awal-buka (±12 detik): detak jantung utas utama + evaluator tampilan (cuplikan PixelCopy area baca, hitung transisi teks/gambar; kotak halaman kosong dan indikator memuat diabaikan) + sinyal mesin PDF sebagai pendukung.
  - Yakin macet (kosong 2 cuplikan, diam, tanpa sinyal) → dialog satu tombol "Coba lagi" (mulai ulang proses, buka PDF & halaman yang sama).
  - Ragu → bar ringan "Halaman belum merespons" Muat ulang | Kembali (hilang sendiri 10 detik).
  - Ketuk 5x dalam 3 detik selama PDF belum terbukti tampil → bar ringan yang sama.
  - Utas utama tersangkut ≥8 detik → mulai ulang otomatis sekali (tidak berulang).
  - Ada jendela lain di atas (mis. dialog kata sandi) → keputusan ditunda, diulang saat fokus kembali.
- Opsi "Pilih file lain" dan "Tunggu" dihapus dari dialog macet; coba ulang otomatis dalam proses (7 detik) diganti pengawas baru.
- Log diagnostik berkas (~200 KB, tahan mati paksa), tersembunyi di Tentang: ketuk versi 5x → Salin log / Kirim log. Tanpa nama berkas, alamat, atau isi dokumen (disaring otomatis).

## 1.0.0 — TeGe Office
- Nama aplikasi menjadi **TeGe Office** (wordmark "TeGe" tebal + "Office" tipis; monogram ikon tetap "TG"), di beranda, Tentang, footer, kebijakan privasi, syarat, halaman penerima, log, dan nama APK (`TeGe-Office-<versi>.apk`).
- Label "Beta" dihapus dari tampilan; versi 1.0.0 (versionCode 10000).
- Ketuk 5x selama PDF dimuat kini hanya dihitung bila sudah menunggu >4 detik dan halaman belum terlihat (kosong/tak terbaca), sehingga tidak ada alarm palsu saat pembukaan normal.
- Paket build uji tetap `com.totogutomo.tgoffice.beta` (agar tidak bentrok dengan APK lama). Paket final untuk Play: `com.totogutomo.tgoffice`.
- Ditunda ke 1.1: Presentasi ke Layar Lain untuk PDF, Word, dan Excel. Uji suara/volume dan suara pengganti: 15 Okt.

## 1.0.1 — Perbaikan tampilan Word
- Penampil Word ditulis ulang (`web/js/viewers/docx.js`) agar tampilannya mendekati hasil LibreOffice. Diuji dengan Jadwal_Penguatan_TKA_XII_15-22_Oktober_2026.docx dan FORM-KP4_Toto_Gutomo.docx.
- Format dasar kini diambil dari gaya dokumen (styles.xml, termasuk turunan gaya, gaya karakter, dan font tema), bukan lagi tebakan ukuran judul. Perintah "tebal mati" (`b val=0`) kini dibaca dengan benar.
- Font pengganti dibundel (OFL, sekitar 240 KB, lebih kecil dari perkiraan 1–2 MB karena hanya aksara Latin): Times New Roman → TG Serif (Liberation Serif), Arial dan Segoe UI → TG Sans (Liberation Sans), Calibri dan Aptos → TG Humanist (Carlito). Nama keluarga font diganti sesuai ketentuan OFL. Teks lisensi: `web/fonts/OFL-Liberation-Carlito.txt`, juga ditambahkan di halaman Lisensi.
- Rata kolom dan tab stop (kiri, tengah, kanan, desimal, titik-titik pengisi, kelipatan bawaan 0,5 inci), indentasi menggantung, dan penomoran (angka, a b c, romawi, butir) berfungsi.
- Tabel: sel gabung (kolom dan baris), lebar kolom, garis, warna latar, ketinggian baris, perataan tabel, bantalan sel, dan gaya tabel Word. Di mode Mengalir, tabel lebar bisa digeser ke samping.
- Mode Halaman: ukuran dan margin kertas sesuai dokumen (A4, folio, mendatar), tabel panjang dipotong per baris dengan baris judul diulang, header dan footer dasar tampil (isi teks dan gambar; nomor halaman otomatis dan kop bergambar lengkap menyusul di 1.0.2). Garis dan gambar yang melayang di atas teks ikut tampil.
- Catatan lisensi suara balik halaman: `docs/LISENSI-SUARA.md` (Pixabay Content License).
- Versi 1.0.1 (versionCode 10001).
- Belum ditangani: kolom koran, kotak teks, catatan kaki, dan paragraf sangat panjang yang melewati batas halaman tidak dipotong per baris.


## 1.0.2 — Pengaturan dan nomor halaman Word
- Ikon "i" di beranda diganti ikon roda gigi yang membuka halaman **Pengaturan** (sesuai mockup `docs/mockup/Pengaturan.dc.html`, tanpa Layar tetap menyala dan Mode baca yang dibatalkan):
  - Tampilkan progres file terakhir (bawaan Ya). Bila Tidak, kartu "Lanjutkan membaca" di beranda diganti tampilan awal.
  - Tampilan bawaan saat file dibuka: Word (Mengalir | Halaman), PowerPoint (Satu slide | Gulir), PDF (Gulir | Flipbook). File yang pernah dibuka dari riwayat tetap memakai tampilan terakhirnya. Flipbook bawaan baru aktif setelah halaman PDF terbukti tampil, supaya pengaman PDF macet tidak terganggu.
  - Riwayat: pemakaian salinan sementara (dari 60 MB), Bersihkan salinan sementara, Hapus semua riwayat (dengan konfirmasi; file di HP tidak ikut terhapus).
  - Kirim masukan: membuka aplikasi surel ke totogutomo92@gmail.com.
  - Tentang TeGe Office di baris paling bawah, membuka halaman Tentang yang sama.
- Tentang: tulisan di bawah nama pembuat menjadi "Guru SMA Negeri 3 Maliku"; versi tampil "Versi 1.0.2".
- Word: nomor halaman otomatis di header/footer (mode Halaman), "Halaman X dari Y" kini terisi (PAGE, NUMPAGES, SECTIONPAGES, termasuk nomor awal dan format romawi/huruf). Diuji dengan Sampel_Word_TeGe_Office_2_Halaman.docx.
- Word: warna tema yang dimudakan/digelapkan (tint/shade) kini dihitung, sehingga baris berselang gaya tabel seperti "Light Shading Accent 1" tampil biru muda dengan teks terbaca.
- Tombol Back menutup halaman paling atas dulu (mis. Tentang yang dibuka dari Pengaturan kembali ke Pengaturan).
- Versi 1.0.2 (versionCode 10002).
