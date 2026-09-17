/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Command line helper shipped alongside Firefox for working with Windows push
//! notifications. This is currently plumbing only and can be invoked from a console,
//! but implements no commands yet.

mod lifecycle;

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;

const PROGRAM: &str = env!("CARGO_BIN_NAME");

/// File that every Firefox profile directory carries, used to tell a profile
/// apart from an arbitrary directory.
const PROFILE_MARKER: &str = "compatibility.ini";

#[derive(Parser)]
#[command(name = PROGRAM, about, disable_version_flag = true)]
struct Args {
    /// Firefox profile directory this helper serves.
    #[arg(long, value_name = "PATH", required_unless_present = "stop")]
    profile: Option<PathBuf>,

    /// Ask this profile's helper to exit, rather than starting one.
    #[arg(long)]
    stop: bool,
}

/// Verifies if <path> is a real profile directory. Note: it is fairly easy to
/// bypass this check, so this only exists as a spot check for calls to this helper.
/// Do not treat this as a guarantee that the profile is real.
fn check_profile(path: &Path) -> Result<(), String> {
    match path.metadata() {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => return Err(format!("not a directory: {}", path.display())),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err(format!("no such directory: {}", path.display()));
        }
        Err(error) => return Err(format!("cannot read {}: {error}", path.display())),
    }

    if !path.join(PROFILE_MARKER).is_file() {
        return Err(format!("not a Firefox profile: {}", path.display()));
    }

    Ok(())
}

/// Starts the notification work for `profile`, parks until another process asks
/// it to stop, then tears the work down.
fn run(profile: &Path) -> ExitCode {
    // Ensure that only one helper exists per profile. Held until the process exits.
    let _guard = match lifecycle::ProfileGuard::acquire(profile) {
        Ok(Some(guard)) => guard,
        Ok(None) => {
            // A helper is already serving this profile. Leave it alone.
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("{PROGRAM}: {message}");
            return ExitCode::FAILURE;
        }
    };

    let stop = match lifecycle::StopEvent::open(profile) {
        Ok(stop) => stop,
        Err(message) => {
            eprintln!("{PROGRAM}: {message}");
            return ExitCode::FAILURE;
        }
    };

    println!("Starting to fetch notifications 🦀 🦊");
    println!("profile: {}", profile.display());

    let worker = std::thread::spawn(|| {
        // TODO: all of the websocket work goes here. Connect to the push
        // service and keep reading notifications until the connection is
        // closed out from under this thread.
        loop {
            std::thread::park();
        }
    });

    if let Err(message) = stop.wait() {
        eprintln!("{PROGRAM}: {message}");
        return ExitCode::FAILURE;
    }

    // TODO: close the push connection so the worker's pending read returns,
    // then join it here. Currently, we just detach the thread to account for
    // the loop.
    drop(worker);

    ExitCode::SUCCESS
}

fn main() -> ExitCode {
    let args = Args::parse();

    if args.stop {
        return match lifecycle::send_stop_signal(args.profile.as_deref()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(message) => {
                eprintln!("{PROGRAM}: {message}");
                ExitCode::FAILURE
            }
        };
    }

    let profile = args
        .profile
        .as_deref()
        .expect("clap requires --profile unless --stop is given");

    if let Err(message) = check_profile(profile) {
        eprintln!("{PROGRAM}: {message}");
        return ExitCode::FAILURE;
    }

    run(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::ffi::OsStr;

    use clap::CommandFactory;

    /// clap's own check for a malformed derive: duplicate names, unreachable
    /// arguments, and the like. Cheap, and it fails at build time rather than
    /// on the first user who passes the wrong flag.
    #[test]
    fn the_argument_definition_is_well_formed() {
        Args::command().debug_assert();
    }

    /// clap has no opinion on whether a path exists, so a bogus `--profile`
    /// parses cleanly and is only rejected once `check_profile` looks at it.
    #[test]
    fn a_profile_that_does_not_exist_is_rejected() {
        let path = std::env::temp_dir().join(format!("{PROGRAM}-missing-{}", std::process::id()));
        let args = Args::try_parse_from([
            OsStr::new(PROGRAM),
            OsStr::new("--profile"),
            path.as_os_str(),
        ])
        .unwrap();

        let error = check_profile(args.profile.as_deref().unwrap()).unwrap_err();

        assert!(error.starts_with("no such directory:"), "{error}");
    }

    /// Starting has no default profile, so it must refuse rather than guess.
    /// A bare `--stop` is the exception, covered by
    /// `stop_without_a_profile_is_allowed`.
    #[test]
    fn starting_requires_a_profile() {
        assert!(Args::try_parse_from([PROGRAM]).is_err());
    }

    /// Starting is the default, so an absent --stop must never read as a stop.
    #[test]
    fn stop_is_off_unless_asked_for() {
        let args = Args::try_parse_from([PROGRAM, "--profile", r"c:\profiles\a"]).unwrap();

        assert!(!args.stop);
    }

    #[test]
    fn stop_is_parsed() {
        let args =
            Args::try_parse_from([PROGRAM, "--stop", "--profile", r"c:\profiles\a"]).unwrap();

        assert!(args.stop);
        assert_eq!(args.profile, Some(PathBuf::from(r"c:\profiles\a")));
    }

    /// A bare --stop is the stop-everything spelling, so it must parse without
    /// a profile rather than being rejected the way a bare start is.
    #[test]
    fn stop_without_a_profile_is_allowed() {
        let args = Args::try_parse_from([PROGRAM, "--stop"]).unwrap();

        assert!(args.stop);
        assert_eq!(args.profile, None);
    }

    #[test]
    fn stop_takes_no_value() {
        assert!(Args::try_parse_from([PROGRAM, "--stop=yes", "--profile", r"c:\p"]).is_err());
    }

    /// Firefox starts a helper on every launch, so finding one already running
    /// is the ordinary case rather than a failure.
    #[test]
    fn run_declines_quietly_when_a_helper_already_has_the_profile() {
        let profile = Path::new(r"c:\profiles\run-declines");

        let _held = lifecycle::ProfileGuard::acquire(profile).unwrap().unwrap();

        assert_eq!(run(profile), ExitCode::SUCCESS);
    }
}
