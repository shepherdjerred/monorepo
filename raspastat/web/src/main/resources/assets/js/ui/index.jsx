var Sidebar = React.createClass({
    getInitialState: function () {
        return {
            currentTemp: "",
            target: "",
            mode: "",
            weatherTemp: "",
            weatherCond: ""
        };
    },

    componentDidMount: function () {
        this.serverRequest = $.get(this.props.source, function (result) {
            this.setState({
                currentTemp: Math.round(result.current),
                target: result.target,
                mode: result.mode
            });
        }.bind(this));
        this.weatherRequest = $.get(this.props.weather, function (result) {
            this.setState({
                weatherCond: result.weather[0].main,
                weatherTemp: Math.round(result.main.temp)
            });
        }.bind(this));
    },

    componentWillUnmount: function () {
        this.serverRequest.abort();
        this.weatherRequest.abort();
    },

    render: function () {
        return (
            <div className="pure-u-1 pure-u-md-1-5 sidebar">
                <div>
                    <div className="temp">
                        <h1>{this.state.currentTemp}<span>&deg;F</span></h1>
                        <h2>Current Temperature</h2>
                    </div>
                    <div className="mode off">
                        <h1>{this.state.mode}</h1>
                        <h2>Target Temp: {this.state.target}&deg;F</h2>
                    </div>
                    <div className="weather rain">
                        <h2>Searcy</h2>
                        <h3>{this.state.weatherCond}</h3>
                        <h1>{this.state.weatherTemp}&deg;F</h1>
                    </div>
                    <div className="details">
                        <a>Show Details</a>
                        <ul>
                            <li>Enabled: true</li>
                            <li>Humidity: 50%</li>
                            <li>Tolerance: 3&deg;F</li>
                            <li>Update Period: 1000ms</li>
                            <li>Retry Delay: 500ms</li>
                            <li>Last update (web): 30 seconds ago</li>
                            <li>Last update (core): 2 minutes ago</li>
                        </ul>
                    </div>
                </div>
            </div>
        );
    }
});

var Control = React.createClass({
    render: function () {
        return (
            <div>
                <h1>Control</h1>
                <form className="pure-form pure-form-stacked">
                    <fieldset className="pure-group">
                        <input id="username" type="text" placeholder="Username" required/>
                        <input id="password" type="password" placeholder="Password" required/>
                    </fieldset>
                    <label>Temperature</label>
                    <input id="temp" type="number" placeholder="70" required min="60" max="80"/>
                    <ControlSubmit/>
                </form>
            </div>
        )
    }
});

class ControlSubmit extends React.Component {
    constructor(props) {
        super(props);
        this.handleClick = this.handleClick.bind(this);
    }

    handleClick() {
        var json = {};
        json.operation = "temp";
        json.value = document.getElementById("temp").value;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', "api/set", true);
        xhr.send(JSON.stringify(json));
    }

    render() {
        return (
            <button onClick={this.handleClick} type="button">
                Send
            </button>
        );
    }
}

var Content = React.createClass({
    render: function () {
        return (
            <div className="pure-u-1 pure-u-md-4-5 content">
                <div className="pure-g">
                    <div className="pure-u-1-24"></div>
                    <div className="pure-u-11-12">
                        <div className="pure-g">
                            <div className="pure-u-1">
                                <div className="pure-g">
                                    <div className="pure-u-1 pure-u-md-1-3 controls">
                                        <Control />
                                    </div>
                                    <div className="pure-u-1 pure-u-md-2-3 log">
                                        <div>
                                            <h1>Log</h1>
                                            <h2>Last 5 entries</h2>
                                            <ul>
                                                <li>X changed the temperature to 70&deg;F</li>
                                                <li>X changed the temperature to 70&deg;F</li>
                                                <li>X changed the temperature to 70&deg;F</li>
                                                <li>X changed the temperature to 70&deg;F</li>
                                                <li>X changed the temperature to 70&deg;F</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="pure-u-1 schedule">
                                <div>
                                    <h1>Schedule</h1>
                                    <table className="pure-table pure-table-horizontal">
                                        <thead>
                                        <tr>
                                            <td></td>
                                            <td>Monday</td>
                                            <td>Tuesday</td>
                                            <td>Wednesday</td>
                                            <td>Thursday</td>
                                            <td>Friday</td>
                                            <td>Saturday</td>
                                            <td>Sunday</td>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        <tr>
                                            <td>Midnight</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>1:00 AM</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>2:00 AM</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>3:00 AM</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>4:00 AM</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>5:00 AM</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                            <td>65&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>6:00 AM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>7:00 AM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>8:00 AM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>9:00 AM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>10:00 AM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>11:00 AM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>Noon</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>1:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>2:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>3:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>4:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>5:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>6:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>7:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>8:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>9:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>10:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        <tr>
                                            <td>11:00 PM</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                            <td>70&deg;F</td>
                                        </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="pure-u-1 graph">
                                <div>
                                    <h1>Graph</h1>
                                    <div id="tempGraph">

                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
});

var Index = React.createClass({
    render: function () {
        return (
            <div className="pure-u-1">
                <div className="pure-g">
                    <Sidebar source="http://10.2.90.194:8080/api/status"
                             weather="http://api.openweathermap.org/data/2.5/weather?zip=72149,us&units=imperial&appid=c1d22aea891556cbea7a69d7c70d04a1"/>
                    <Content />
                </div>
            </div>
        );
    }
});

ReactDOM.render(
    <Index />,
    document.getElementById('content')
);