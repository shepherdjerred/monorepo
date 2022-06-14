import React, { Component } from 'react';
import { SOAP_URL } from '../../config';
import * as soap from 'soap';
import NarrowLayout from '../fragments/layout/NarrowLayout';

export default class ReleaseSeat extends Component {
  constructor () {
    super();
    this.state = {
      form: {
        pidm: '',
        term: ''
      },
      status: {
        isLoading: false,
        error: undefined,
        result: undefined
      }
    };

    this.onTermChange = this.onTermChange.bind(this);
    this.onPidmChange = this.onPidmChange.bind(this);
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

  onPidmChange (event) {
    this.setState({
      form: {
        ...this.state.form,
        pidm: event.target.value
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
          client.ReleaseSeat({
            Pidm: this.state.form.pidm,
            Term: this.state.form.term
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
                Release Seat
              </h1>
            </div>
          </div>
        </section>
        <NarrowLayout>
          {this.state.status.error && (<div className='notification is-danger'>{JSON.stringify(this.state.status.error)}</div>)}
          {this.state.status.result && (<div className='notification'>{this.state.status.result.ReleaseSeatResult}</div>)}
          <form onSubmit={this.onSubmit}>
            <label className='label'>
              Pidm
              <input type='text' placeholder='0123456' className='input' value={this.state.form.pidm} onChange={this.onPidmChange} />
            </label>
            <label className='label'>
              Term
              <input type='text' placeholder='201990' className='input' value={this.state.form.term} onChange={this.onTermChange} />
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
