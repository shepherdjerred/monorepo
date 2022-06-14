import React, { Component } from 'react';
import { SOAP_URL } from '../../config';
import * as soap from 'soap';
import NarrowLayout from '../fragments/layout/NarrowLayout';

export default class CheckForSeat extends Component {
  constructor () {
    super();
    this.state = {
      form: {
        term: '',
        auditorium: '',
        floor: 'F',
        section: ''
      },
      status: {
        isLoading: false,
        error: undefined,
        result: undefined
      }
    };

    this.onTermChange = this.onTermChange.bind(this);
    this.onAuditoriumChange = this.onAuditoriumChange.bind(this);
    this.onFloorChange = this.onFloorChange.bind(this);
    this.onSectionChange = this.onSectionChange.bind(this);
    this.onSubmit = this.onSubmit.bind(this);
  }

  onTermChange (event) {
    this.setState({
      form: {
        ...this.state.form,
        term: event.target.value
      }
    });
  }

  onAuditoriumChange (event) {
    this.setState({
      form: {
        ...this.state.form,
        auditorium: event.target.value
      }
    });
  }

  onFloorChange (event) {
    this.setState({
      form: {
        ...this.state.form,
        floor: event.target.value
      }
    });
  }

  onSectionChange (event) {
    this.setState({
      form: {
        ...this.state.form,
        section: event.target.value
      }
    });
  }

  onSubmit (event) {
    event.preventDefault();
    if (!this.state.status.isLoading) {
      this.setState({
        status: {
          isLoading: true,
          error: undefined,
          result: undefined
        }
      });
      soap.createClient(SOAP_URL, (err, client) => {
        if (err) {
          this.setState({
            status: {
              ...this.state.status,
              error: err
            }
          });
          console.log(err);
        } else {
          client.GetSeats({
            Term: this.state.form.term,
            Auditorium: this.state.form.auditorium,
            Floor: this.state.form.floor,
            Section: this.state.form.section
          }, (err, result) => {
            if (err) {
              this.setState({
                status: {
                  ...this.state.status,
                  isLoading: false,
                  error: err
                }
              });
              console.log(err);
            } else {
              this.setState({
                status: {
                  ...this.state.status,
                  isLoading: false,
                  result: result
                }
              });
              console.log(result);
            }
          });
        }
      });
    }
  }

  render () {
    return (
      <div>
        <section className='hero is-primary'>
          <div className='hero-body'>
            <div className='container'>
              <h1 className='title'>
                Get Seats
              </h1>
            </div>
          </div>
        </section>
        <NarrowLayout>
          {this.state.status.error && (<div className='notification is-danger'>{JSON.stringify(this.state.status.error)}</div>)}
          {this.state.status.result && (<div className='notification'>{this.state.status.result.GetSeatsResult.string.map(s => {
            return <div>{s}</div>;
          })}</div>)}
          <form onSubmit={this.onSubmit}>
            <label className='label'>
              Term
              <input type='text' className='input' placeholder='201990' value={this.state.form.term} onChange={this.onTermChange} />
            </label>
            <label className='label'>
              Auditorium
              <input type='text' className='input' placeholder='B' value={this.state.form.auditorium} onChange={this.onAuditoriumChange} />
            </label>
            <label className='label'>
              Floor
              <input type='text' className='input' placeholder='F' value={this.state.form.floor} onChange={this.onFloorChange} />
            </label>
            <label className='label'>
              Section
              <input type='text' className='input' placeholder='1A' value={this.state.form.section} onChange={this.onSectionChange} />
            </label>
            {this.state.status.isLoading
              ? <input type='submit' value='Loading' className='button is-primary' disabled />
              : <input type='submit' value='Submit' className='button is-primary' />}
          </form>
        </NarrowLayout>
      </div>
    );
  }
}
