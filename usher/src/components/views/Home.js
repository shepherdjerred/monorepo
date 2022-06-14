import React from 'react';
import WideLayout from '../fragments/layout/WideLayout';
import { Link } from 'react-router-dom';

export default function Home () {
  return (
    <div>
      <section className='hero is-primary'>
        <div className='hero-body'>
          <div className='container'>
            <h1 className='title'>
              How to use Usher
            </h1>
          </div>
        </div>
      </section>
      <WideLayout>
        <div>
          <h2 className='title is-4'>Step 1: Disable Browser Security</h2>
          <p>
            You will need to disable browser security to use Usher. This is required so that CORS requests can be
            made. <a
              href='https://stackoverflow.com/questions/3102819/disable-same-origin-policy-in-chrome'>This</a> Stack
            Exchange question details how.
    
            Or do it quickly on macOS with this command: open -a Google\ Chrome --args --disable-web-security --user-data-dir
          </p>

          <br />
          <h2 className='title is-4'>Step 2: Learn How to Format Input</h2>
          <h3 className='title is-5'>Pidm</h3>
          <p>
            Your pidm is used to identify students and their chapel seat. In order to pick or release a seat, you will
            need to know your pidm. You can find through the following procedure.
          </p>
          <br />
          <div className='column'>
            <ol>
              <li>Navigate to <a href='https://ssb.pipeline.harding.edu/hrdg/szpseat.P_PickSeat'>this page</a></li>
              <li>View the page source</li>
              <li>Search for an input with the name "pidm"</li>
              <li>Copy the value of the input</li>
            </ol>
          </div>

          <br />
          <h3 className='title is-5'>Term</h3>
          <p>
            Terms follow this format: yyyyXX, where yyyy is the four digit year, and XX is either 10 for Spring or 90
            for
            Fall. For example, 201990 represents Fall of 2019.
          </p>

          <br />
          <h3 className='title is-5'>Auditorium</h3>
          <p>
            B represents 9:00 chapel, C represents 10:00 chapel.
          </p>

          <br />
          <h3 className='title is-5'>Floor</h3>
          <p>
            This should always be F.
          </p>

          <br />
          <h3 className='title is-5'>Section</h3>
          <p>
            Section follows this format: XY, where X is the first number of the section, and Y is either A to represent
            the section before the break, or B to represent the section after the break.
            For example, 3A would represent section 300 before the break.
          </p>

          <br />
          <h3 className='title is-5'>Seat</h3>
          <p>
            Seat follows with format: X-Y, where X is the row letter, and Y is the seat number. For example, A-3
            represents the third seat in row A.
          </p>

          <br />
          <h2 className='title is-4'>Step 3: Pick a Chapel Seat</h2>
          <p>
            You are now ready to pick a chapel seat. Select <Link to='/pickSeat'>Pick Seat</Link> from the navbar above
            and enter the chapel seat
            you would like. If you change your mind, release your current seat by going to <Link to='/releaseSeat'>Release
            Seat</Link>. You can view your
            current seat through <Link to='checkForSeat'>Check For Seat</Link>, and see the status of other seats
            through <Link to='getSeats'>Get Seats</Link>.
          </p>
        </div>
      </WideLayout>
    </div>
  );
}
