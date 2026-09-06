// Thin CLI over bobeberlein/xmutil's `convert_xmile_to_mdl` C entry point (see
// third_party/xmutil/XMUtil.h). Reads an XMILE file and writes the Vensim `.mdl` xmutil itself
// generates from it — the same MDLGenerator logic real Vensim's own creator's tool uses, rather
// than this repo's own from-scratch `.mdl` sketch writer (packages/core/src/mdl/writer.ts).

use std::ffi::{CStr, CString};
use std::fs;
use std::os::raw::{c_char, c_int, c_uint};
use std::process::ExitCode;

extern "C" {
    fn convert_xmile_to_mdl(source: *const c_char, len: c_uint, file_name: *const c_char, is_long_name: c_int) -> *mut c_char;
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: xmutil-bridge <input.xmile> <output.mdl>");
        return ExitCode::FAILURE;
    }
    let input_path = &args[1];
    let output_path = &args[2];

    let source = match fs::read_to_string(input_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error reading {input_path}: {e}");
            return ExitCode::FAILURE;
        }
    };

    let source_c = match CString::new(source.as_bytes()) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("input contains an embedded NUL byte: {e}");
            return ExitCode::FAILURE;
        }
    };
    let file_name_c = CString::new(input_path.as_bytes()).unwrap_or_else(|_| CString::new("model.xmile").unwrap());

    // SAFETY: convert_xmile_to_mdl is a well-defined extern "C" function (XMUtil.h) that reads
    // `source` for exactly `len` bytes and returns either NULL or a NUL-terminated,
    // heap-allocated string the caller owns. We pass a valid, NUL-free-checked buffer and its
    // exact length, and only read the result through CStr afterward.
    let result_ptr = unsafe { convert_xmile_to_mdl(source_c.as_ptr(), source.len() as c_uint, file_name_c.as_ptr(), 0) };

    if result_ptr.is_null() {
        eprintln!("xmutil could not convert {input_path} (parse error — see stderr above, if any, for xmutil's own diagnostics)");
        return ExitCode::FAILURE;
    }

    // SAFETY: result_ptr is non-null and, per XMUtil.h's contract, NUL-terminated.
    let mdl_text = unsafe { CStr::from_ptr(result_ptr) }.to_string_lossy().into_owned();
    // Deliberately not freeing result_ptr: xmutil's C API gives no matching free function, and
    // this is a one-shot CLI process where the OS reclaims the allocation on exit anyway.

    if let Err(e) = fs::write(output_path, mdl_text) {
        eprintln!("error writing {output_path}: {e}");
        return ExitCode::FAILURE;
    }

    println!("wrote {output_path}");
    ExitCode::SUCCESS
}
